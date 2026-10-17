/**
 * Gift lifecycle against a real Postgres with a recording mailer and fake
 * Stripe credits. Runs only when TEST_DATABASE_URL points at a disposable
 * database (tables are truncated).
 */
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import type { EmailMessage, Mailer } from "@/lib/email";
import { monthPeriod } from "@/lib/revenue/pool";
import { settlePeriod } from "@/lib/revenue/settlement";
import {
  addMonths,
  createPendingGift,
  deliverDueGifts,
  GiftError,
  markGiftPaid,
  redeemGift,
  refundGiftPayment,
  sendPurchaserConfirmation,
  type BillingCredits,
  type Gift,
  type NewGift,
} from "./service";

const url = process.env.TEST_DATABASE_URL;
const APP = "https://fatherhood.test";
const NOW = new Date("2026-10-17T12:00:00Z");

class RecordingMailer implements Mailer {
  sent: EmailMessage[] = [];
  failNext = 0;
  async send(message: EmailMessage) {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error("mail server down");
    }
    this.sent.push(message);
  }
}

class FakeCredits implements BillingCredits {
  calls: { customerId: string; amountCents: number; key: string }[] = [];
  async adjust(customerId: string, amountCents: number, _description: string, key: string) {
    this.calls.push({ customerId, amountCents, key });
    return `cbtxn_${this.calls.length}`;
  }
}

describe.skipIf(!url)("gift memberships (Postgres)", () => {
  let client: postgres.Sql;
  let db: Database;
  let mailer: RecordingMailer;
  let credits: FakeCredits;

  beforeAll(async () => {
    client = postgres(url!, { max: 4, onnotice: () => {} });
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: "drizzle" });
  });

  afterAll(async () => {
    await client?.end();
  });

  beforeEach(async () => {
    await db.execute(sql`truncate gifts, subscriptions, revenue_ledger, pool_shares, pool_calculations, creator_payouts, "user" cascade`);
    await db.insert(schema.user).values([
      { id: "giver", name: "Marcus", email: "marcus@test.dev" },
      { id: "dad", name: "Dad", email: "dad@test.dev" },
      { id: "subscriber", name: "Sam", email: "sam@test.dev", stripeCustomerId: "cus_sam" },
    ]);
    mailer = new RecordingMailer();
    credits = new FakeCredits();
  });

  const newGift = (overrides: Partial<NewGift> = {}): NewGift => ({
    plan: "annual",
    purchaserUserId: "giver",
    purchaserName: "Marcus",
    purchaserEmail: "marcus@test.dev",
    recipientName: "Dad",
    delivery: "email",
    recipientEmail: "dad@test.dev",
    message: "For everything.",
    deliverAt: null,
    ...overrides,
  });

  let sessionCounter = 0;
  async function paidGift(overrides: Partial<NewGift> = {}): Promise<Gift> {
    const gift = await createPendingGift(db, newGift(overrides));
    sessionCounter++;
    const paid = await markGiftPaid(db, {
      giftId: gift.id,
      checkoutSessionId: `cs_${sessionCounter}`,
      paymentIntentId: `pi_${sessionCounter}`,
      amountPaidCents: gift.amountCents,
      paidAt: NOW,
    });
    return paid!;
  }

  const giftRow = async (id: string) => (await db.query.gifts.findFirst({ where: eq(schema.gifts.id, id) }))!;

  describe("purchase and payment", () => {
    it("creates a pending gift priced like the plan, with a code", async () => {
      const gift = await createPendingGift(db, newGift({ plan: "monthly" }));
      expect(gift).toMatchObject({ status: "pending_payment", amountCents: 19_00, plan: "monthly", delivery: "email" });
      expect(gift.code).toMatch(/^FATHER-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    });

    it("drops the recipient address and date for self-delivered gifts", async () => {
      const gift = await createPendingGift(db, newGift({ delivery: "self", deliverAt: new Date("2027-06-20T12:00:00Z") }));
      expect(gift).toMatchObject({ recipientEmail: null, deliverAt: null });
    });

    it("marks a gift paid exactly once and records the revenue", async () => {
      const gift = await createPendingGift(db, newGift());
      const payment = { giftId: gift.id, checkoutSessionId: "cs_x", paymentIntentId: "pi_x", amountPaidCents: 199_00, paidAt: NOW };
      expect(await markGiftPaid(db, payment)).toMatchObject({ status: "paid", stripePaymentIntentId: "pi_x" });
      expect(await markGiftPaid(db, payment)).toBeNull();
      expect(await db.select().from(schema.revenueLedger)).toEqual([
        expect.objectContaining({ kind: "gift", stripeObjectId: "cs_x", amountCents: 199_00, userId: "giver" }),
      ]);
    });

    it("counts gift revenue toward the creator pool", async () => {
      await paidGift();
      const result = await settlePeriod(db, monthPeriod(2026, 10));
      expect(result).toMatchObject({ subscriptionRevenueCents: 199_00, poolCents: 49_75 });
    });
  });

  describe("delivery", () => {
    it("emails gifts that are due, waits for scheduled ones, and never emails self-delivered ones", async () => {
      const now = await paidGift();
      const later = await paidGift({ deliverAt: new Date("2027-06-20T12:00:00Z") });
      await paidGift({ delivery: "self", recipientEmail: null });
      await createPendingGift(db, newGift()); // unpaid

      expect((await deliverDueGifts(db, mailer, APP, NOW)).delivered).toEqual([now.id]);
      expect(mailer.sent.map((m) => [m.to, m.idempotencyKey])).toEqual([["dad@test.dev", `gift-recipient-${now.id}`]]);
      expect(mailer.sent[0]!.text).toContain(now.code);

      // Nothing new until the scheduled date arrives; already-delivered gifts are not resent.
      expect((await deliverDueGifts(db, mailer, APP, NOW)).delivered).toEqual([]);
      expect((await deliverDueGifts(db, mailer, APP, new Date("2027-06-20T12:00:00Z"))).delivered).toEqual([later.id]);
      expect(mailer.sent).toHaveLength(2);
    });

    it("records a failed send and retries it on the next run", async () => {
      const gift = await paidGift();
      mailer.failNext = 1;
      expect(await deliverDueGifts(db, mailer, APP, NOW)).toEqual({ delivered: [], failed: [gift.id] });
      expect(await giftRow(gift.id)).toMatchObject({ deliveredAt: null, deliveryError: "mail server down" });

      expect((await deliverDueGifts(db, mailer, APP, NOW)).delivered).toEqual([gift.id]);
      expect(await giftRow(gift.id)).toMatchObject({ deliveryError: null });
    });

    it("skips gifts redeemed before their delivery date", async () => {
      const gift = await paidGift({ deliverAt: new Date("2027-06-20T12:00:00Z") });
      await redeemGift(db, { code: gift.code, user: { id: "dad", stripeCustomerId: null } }, credits, NOW);
      expect((await deliverDueGifts(db, mailer, APP, new Date("2027-06-21T00:00:00Z"))).delivered).toEqual([]);
    });

    it("sends the purchaser confirmation with an idempotency key", async () => {
      const gift = await paidGift();
      await sendPurchaserConfirmation(gift, mailer, APP);
      expect(mailer.sent[0]).toMatchObject({ to: "marcus@test.dev", idempotencyKey: `gift-purchaser-${gift.id}` });
    });
  });

  describe("redemption", () => {
    const redeem = (code: string, userId: string, stripeCustomerId: string | null = null, now = NOW) =>
      redeemGift(db, { code, user: { id: userId, stripeCustomerId } }, credits, now);

    it("starts a gift membership for someone without one", async () => {
      const gift = await paidGift();
      const result = await redeem(gift.code.toLowerCase().replace(/-/g, " "), "dad");

      expect(result).toEqual({ kind: "access", plan: "annual", accessUntil: new Date("2027-10-17T12:00:00Z") });
      const [membership] = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.userId, "dad"));
      expect(membership).toMatchObject({ plan: "gift", status: "active", cancelAtPeriodEnd: true, stripeSubscriptionId: null });
      expect(await giftRow(gift.id)).toMatchObject({ status: "redeemed", redeemedByUserId: "dad", redemption: "access", subscriptionId: membership!.id });
    });

    it("stacks a second gift after the first instead of overlapping", async () => {
      const first = await paidGift();
      const second = await paidGift({ plan: "monthly" });
      await redeem(first.code, "dad");
      const result = await redeem(second.code, "dad");
      expect(result).toMatchObject({ kind: "access", accessUntil: addMonths(new Date("2027-10-17T12:00:00Z"), 1) });
    });

    it("starts after a cancelled subscription's paid time runs out", async () => {
      await db.insert(schema.subscriptions).values({
        userId: "subscriber",
        plan: "monthly",
        status: "active",
        stripeSubscriptionId: "sub_cancelling",
        stripeCustomerId: "cus_sam",
        currentPeriodEnd: new Date("2026-11-01T00:00:00Z"),
        cancelAtPeriodEnd: true,
      });
      const gift = await paidGift();
      const result = await redeem(gift.code, "subscriber", "cus_sam");
      expect(result).toEqual({ kind: "access", plan: "annual", accessUntil: new Date("2027-11-01T00:00:00Z") });
      expect(credits.calls).toEqual([]);
    });

    it("turns the gift into billing credit for an auto-renewing subscriber", async () => {
      await db.insert(schema.subscriptions).values({
        userId: "subscriber",
        plan: "annual",
        status: "active",
        stripeSubscriptionId: "sub_renewing",
        stripeCustomerId: "cus_sam",
        currentPeriodEnd: new Date("2027-03-01T00:00:00Z"),
      });
      const gift = await paidGift();
      const result = await redeem(gift.code, "subscriber", "cus_sam");

      expect(result).toEqual({ kind: "billing_credit", plan: "annual", creditCents: 199_00 });
      expect(credits.calls).toEqual([{ customerId: "cus_sam", amountCents: -199_00, key: `gift-credit-${gift.id}` }]);
      expect(await db.$count(schema.subscriptions, eq(schema.subscriptions.userId, "subscriber"))).toBe(1);
      expect(await giftRow(gift.id)).toMatchObject({ redemption: "billing_credit", stripeBalanceTransactionId: "cbtxn_1" });
    });

    it("explains every reason a code can't be redeemed", async () => {
      const reason = async (promise: Promise<unknown>) => {
        try {
          await promise;
          return "redeemed";
        } catch (error) {
          return error instanceof GiftError ? error.reason : String(error);
        }
      };
      const unpaid = await createPendingGift(db, newGift());
      const gift = await paidGift();
      expect(await reason(redeem("not a code", "dad"))).toBe("invalid_code");
      expect(await reason(redeem("FATHER-ZZZZ-ZZZZ", "dad"))).toBe("invalid_code");
      expect(await reason(redeem(unpaid.code, "dad"))).toBe("not_paid");
      await redeem(gift.code, "dad");
      expect(await reason(redeem(gift.code, "dad"))).toBe("already_redeemed_by_you");
      expect(await reason(redeem(gift.code, "giver"))).toBe("already_redeemed");
    });

    it("lets only one of two simultaneous redemptions succeed", async () => {
      const gift = await paidGift();
      const results = await Promise.allSettled([redeem(gift.code, "dad"), redeem(gift.code, "giver")]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(rejected.reason).toBeInstanceOf(GiftError);
      expect(await db.$count(schema.subscriptions)).toBe(1);
    });
  });

  describe("refunds", () => {
    it("voids an unredeemed gift", async () => {
      const gift = await paidGift();
      const refunded = await refundGiftPayment(db, { paymentIntentId: gift.stripePaymentIntentId!, fullyRefunded: true }, credits, NOW);
      expect(refunded).toMatchObject({ status: "refunded", refundedAt: NOW });
      await expect(redeemGift(db, { code: gift.code, user: { id: "dad", stripeCustomerId: null } }, credits, NOW)).rejects.toThrowError(/refunded/);
    });

    it("ends gift membership time immediately", async () => {
      const gift = await paidGift();
      await redeemGift(db, { code: gift.code, user: { id: "dad", stripeCustomerId: null } }, credits, NOW);
      const later = new Date("2026-10-20T00:00:00Z");
      await refundGiftPayment(db, { paymentIntentId: gift.stripePaymentIntentId!, fullyRefunded: true }, credits, later);
      const [membership] = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.userId, "dad"));
      expect(membership).toMatchObject({ status: "canceled", currentPeriodEnd: later });
    });

    it("reverses billing credit", async () => {
      await db.insert(schema.subscriptions).values({
        userId: "subscriber",
        plan: "annual",
        status: "active",
        stripeSubscriptionId: "sub_renewing",
        stripeCustomerId: "cus_sam",
        currentPeriodEnd: new Date("2027-03-01T00:00:00Z"),
      });
      const gift = await paidGift();
      await redeemGift(db, { code: gift.code, user: { id: "subscriber", stripeCustomerId: "cus_sam" } }, credits, NOW);
      await refundGiftPayment(db, { paymentIntentId: gift.stripePaymentIntentId!, fullyRefunded: true }, credits, NOW);
      expect(credits.calls[1]).toEqual({ customerId: "cus_sam", amountCents: 199_00, key: `gift-credit-reversal-${gift.id}` });
    });

    it("ignores partial refunds, unknown payments and repeats", async () => {
      const gift = await paidGift();
      expect(await refundGiftPayment(db, { paymentIntentId: gift.stripePaymentIntentId!, fullyRefunded: false }, credits)).toBeNull();
      expect(await giftRow(gift.id)).toMatchObject({ status: "paid" });
      expect(await refundGiftPayment(db, { paymentIntentId: "pi_unknown", fullyRefunded: true }, credits)).toBeNull();
      await refundGiftPayment(db, { paymentIntentId: gift.stripePaymentIntentId!, fullyRefunded: true }, credits);
      expect(await refundGiftPayment(db, { paymentIntentId: gift.stripePaymentIntentId!, fullyRefunded: true }, credits)).toBeNull();
    });
  });
});
