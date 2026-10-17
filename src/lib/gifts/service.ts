/**
 * Gift memberships: purchase, payment, delivery, redemption and refunds.
 *
 * Flow (docs/development-plan.md 5.3): checkout creates a pending gift with its
 * code -> Stripe confirms payment -> the code is emailed (now, on a chosen date,
 * or handed over by the purchaser) -> the recipient redeems it on their account.
 */
import { and, desc, eq, gt, inArray, isNotNull, isNull, lte, or } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { gifts, revenueLedger, subscriptions, user, type GiftStatus } from "@/lib/db/schema";
import { GIFT_TERMS, PLANS, type PlanId } from "@/lib/config";
import type { Mailer } from "@/lib/email";
import { generateGiftCode, normalizeGiftCode } from "./codes";
import { purchaserEmail, recipientEmail, type GiftForEmail } from "./emails";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Database | Transaction;

export type Gift = typeof gifts.$inferSelect;

export class GiftError extends Error {
  constructor(
    readonly reason:
      | "invalid_code"
      | "not_paid"
      | "refunded"
      | "already_redeemed"
      | "already_redeemed_by_you"
      | "no_billing_account",
    message: string,
  ) {
    super(message);
    this.name = "GiftError";
  }
}

/** Applies a Stripe customer-balance credit (negative amount) or debit; returns the transaction id. */
export interface BillingCredits {
  adjust(customerId: string, amountCents: number, description: string, idempotencyKey: string): Promise<string>;
}

/** Add calendar months in UTC, clamping to the last day of shorter months (Jan 31 + 1 = Feb 28). */
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

export function toEmailGift(gift: Gift): GiftForEmail {
  return {
    code: gift.code,
    plan: gift.plan as PlanId,
    purchaserName: gift.purchaserName,
    purchaserEmail: gift.purchaserEmail,
    recipientName: gift.recipientName,
    recipientEmail: gift.recipientEmail,
    message: gift.message,
    delivery: gift.delivery,
    deliverAt: gift.deliverAt,
  };
}

// ---------------------------------------------------------------------------
// Purchase
// ---------------------------------------------------------------------------

export type NewGift = {
  plan: PlanId;
  purchaserUserId: string | null;
  purchaserName: string;
  purchaserEmail: string;
  recipientName: string;
  delivery: "email" | "self";
  recipientEmail: string | null;
  message: string | null;
  deliverAt: Date | null;
};

/** Create an unpaid gift with a fresh code. Retries the rare code collision. */
export async function createPendingGift(db: Database, input: NewGift): Promise<Gift> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const [row] = await db
      .insert(gifts)
      .values({
        ...input,
        code: generateGiftCode(),
        plan: input.plan,
        amountCents: PLANS[input.plan].amountCents,
        recipientEmail: input.delivery === "email" ? input.recipientEmail : null,
        deliverAt: input.delivery === "email" ? input.deliverAt : null,
        status: "pending_payment",
      })
      .onConflictDoNothing({ target: gifts.code })
      .returning();
    if (row) return row;
  }
  throw new Error("Could not generate a unique gift code.");
}

export async function attachCheckoutSession(db: Database, giftId: string, sessionId: string): Promise<void> {
  await db.update(gifts).set({ stripeCheckoutSessionId: sessionId }).where(eq(gifts.id, giftId));
}

export async function getGiftByCheckoutSession(db: Database, sessionId: string): Promise<Gift | undefined> {
  return db.query.gifts.findFirst({ where: eq(gifts.stripeCheckoutSessionId, sessionId) });
}

/**
 * Record a confirmed payment. Idempotent: returns the gift only for the call
 * that moved it from pending to paid, so emails go out exactly once even when
 * the webhook and the thank-you page both see the payment.
 */
export async function markGiftPaid(
  db: Executor,
  payment: { giftId: string; checkoutSessionId: string; paymentIntentId: string | null; amountPaidCents: number; paidAt: Date },
): Promise<Gift | null> {
  const [paid] = await db
    .update(gifts)
    .set({
      status: "paid",
      paidAt: payment.paidAt,
      stripeCheckoutSessionId: payment.checkoutSessionId,
      stripePaymentIntentId: payment.paymentIntentId,
    })
    .where(and(eq(gifts.id, payment.giftId), eq(gifts.status, "pending_payment")))
    .returning();
  if (!paid) return null;

  // Gift revenue funds the creator pool like subscription revenue does.
  await db
    .insert(revenueLedger)
    .values({
      kind: "gift",
      stripeObjectId: payment.checkoutSessionId,
      userId: paid.purchaserUserId,
      amountCents: payment.amountPaidCents,
      occurredAt: payment.paidAt,
    })
    .onConflictDoNothing();
  return paid;
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

/** Email the purchaser their confirmation and code. Safe to retry (idempotency key). */
export async function sendPurchaserConfirmation(gift: Gift, mailer: Mailer, appUrl: string): Promise<void> {
  await mailer.send({ ...purchaserEmail(toEmailGift(gift), appUrl), idempotencyKey: `gift-purchaser-${gift.id}` });
}

/**
 * Email every paid gift whose delivery date has come. Failures are recorded on
 * the gift and retried on the next run; the idempotency key stops a retry from
 * sending twice if the first attempt actually went through.
 */
export async function deliverDueGifts(
  db: Database,
  mailer: Mailer,
  appUrl: string,
  now: Date = new Date(),
): Promise<{ delivered: string[]; failed: string[] }> {
  const due = await db
    .select()
    .from(gifts)
    .where(
      and(
        eq(gifts.status, "paid"),
        eq(gifts.delivery, "email"),
        isNull(gifts.deliveredAt),
        or(isNull(gifts.deliverAt), lte(gifts.deliverAt, now)),
      ),
    );

  const delivered: string[] = [];
  const failed: string[] = [];
  for (const gift of due) {
    try {
      await mailer.send({ ...recipientEmail(toEmailGift(gift), appUrl), idempotencyKey: `gift-recipient-${gift.id}` });
      await db.update(gifts).set({ deliveredAt: now, deliveryError: null }).where(eq(gifts.id, gift.id));
      delivered.push(gift.id);
    } catch (error) {
      await db
        .update(gifts)
        .set({ deliveryError: error instanceof Error ? error.message : String(error) })
        .where(eq(gifts.id, gift.id));
      failed.push(gift.id);
    }
  }
  return { delivered, failed };
}

// ---------------------------------------------------------------------------
// Redemption
// ---------------------------------------------------------------------------

const ACCESS_STATUSES = ["active", "trialing", "past_due"] as const;

export type Redemption =
  | { kind: "access"; plan: PlanId; accessUntil: Date }
  | { kind: "billing_credit"; plan: PlanId; creditCents: number };

/**
 * Redeem a gift code for a signed-in user.
 *
 * - No paid subscription: a gift membership period starts now, or when the
 *   user's current access ends, so stacked gifts never overlap.
 * - An auto-renewing Stripe subscription: the gift's value becomes billing
 *   credit, which Stripe applies to upcoming invoices, so they never pay twice.
 */
export async function redeemGift(
  db: Database,
  input: { code: string; user: { id: string; stripeCustomerId: string | null } },
  credits: BillingCredits,
  now: Date = new Date(),
): Promise<Redemption> {
  const code = normalizeGiftCode(input.code);
  if (!code) throw new GiftError("invalid_code", "That doesn't look like a gift code. Codes look like FATHER-ABCD-2345.");

  return db.transaction(async (tx) => {
    // Lock the gift so two people can't redeem it at the same moment.
    const [gift] = await tx.select().from(gifts).where(eq(gifts.code, code)).for("update");
    if (!gift) throw new GiftError("invalid_code", "We couldn't find that gift code. Check it and try again.");
    assertRedeemable(gift, input.user.id);

    const plan = gift.plan as PlanId;
    const access = await tx
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.userId, input.user.id),
          inArray(subscriptions.status, [...ACCESS_STATUSES]),
          gt(subscriptions.currentPeriodEnd, now),
        ),
      )
      .orderBy(desc(subscriptions.currentPeriodEnd));
    const renewing = access.find((s) => s.stripeSubscriptionId && !s.cancelAtPeriodEnd);

    if (renewing) {
      const customerId = renewing.stripeCustomerId ?? input.user.stripeCustomerId;
      if (!customerId) throw new GiftError("no_billing_account", "We couldn't find your billing account. Please contact support.");
      const transactionId = await credits.adjust(
        customerId,
        -gift.amountCents,
        `Gift membership ${gift.code}`,
        `gift-credit-${gift.id}`,
      );
      await tx
        .update(gifts)
        .set({
          status: "redeemed",
          redeemedByUserId: input.user.id,
          redeemedAt: now,
          redemption: "billing_credit",
          stripeBalanceTransactionId: transactionId,
        })
        .where(eq(gifts.id, gift.id));
      return { kind: "billing_credit", plan, creditCents: gift.amountCents };
    }

    const startsAt = access[0] && access[0].currentPeriodEnd > now ? access[0].currentPeriodEnd : now;
    const accessUntil = addMonths(startsAt, GIFT_TERMS[plan].months);
    const [membership] = await tx
      .insert(subscriptions)
      .values({ userId: input.user.id, plan: "gift", status: "active", currentPeriodEnd: accessUntil, cancelAtPeriodEnd: true })
      .returning({ id: subscriptions.id });
    await tx
      .update(gifts)
      .set({ status: "redeemed", redeemedByUserId: input.user.id, redeemedAt: now, redemption: "access", subscriptionId: membership!.id })
      .where(eq(gifts.id, gift.id));
    return { kind: "access", plan, accessUntil };
  });
}

function assertRedeemable(gift: Gift, userId: string): void {
  const reasons: Partial<Record<GiftStatus, () => never>> = {
    pending_payment: () => {
      throw new GiftError("not_paid", "This gift's payment hasn't cleared yet. Please try again in a few minutes.");
    },
    refunded: () => {
      throw new GiftError("refunded", "This gift was refunded and can no longer be redeemed.");
    },
    redeemed: () => {
      if (gift.redeemedByUserId === userId) {
        throw new GiftError("already_redeemed_by_you", "You've already redeemed this gift. It's on your account.");
      }
      throw new GiftError("already_redeemed", "This gift code has already been redeemed.");
    },
  };
  reasons[gift.status]?.();
}

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------

/**
 * A full refund of a gift's payment voids the gift: unredeemed codes stop
 * working, gift membership time ends now, and billing credit is reversed.
 * Partial refunds leave the gift as it is.
 */
export async function refundGiftPayment(
  db: Database,
  refund: { paymentIntentId: string; fullyRefunded: boolean },
  credits: BillingCredits,
  now: Date = new Date(),
): Promise<Gift | null> {
  if (!refund.fullyRefunded) return null;
  return db.transaction(async (tx) => {
    const [gift] = await tx
      .select()
      .from(gifts)
      .where(and(eq(gifts.stripePaymentIntentId, refund.paymentIntentId), inArray(gifts.status, ["paid", "redeemed"])))
      .for("update");
    if (!gift) return null;

    if (gift.redemption === "access" && gift.subscriptionId) {
      await tx
        .update(subscriptions)
        .set({ status: "canceled", currentPeriodEnd: now })
        .where(eq(subscriptions.id, gift.subscriptionId));
    }
    if (gift.redemption === "billing_credit" && gift.stripeBalanceTransactionId) {
      const [owner] = await tx.select({ customerId: user.stripeCustomerId }).from(user).where(eq(user.id, gift.redeemedByUserId!));
      const [sub] = owner?.customerId
        ? [owner]
        : await tx
            .select({ customerId: subscriptions.stripeCustomerId })
            .from(subscriptions)
            .where(and(eq(subscriptions.userId, gift.redeemedByUserId!), isNotNull(subscriptions.stripeCustomerId)))
            .limit(1);
      // The credit may already be spent; reversing it then shows as a balance due on the next invoice.
      if (sub?.customerId) {
        await credits.adjust(sub.customerId, gift.amountCents, `Refund of gift membership ${gift.code}`, `gift-credit-reversal-${gift.id}`);
      }
    }

    const [updated] = await tx
      .update(gifts)
      .set({ status: "refunded", refundedAt: now })
      .where(eq(gifts.id, gift.id))
      .returning();
    return updated ?? null;
  });
}
