/**
 * Payouts against a real Postgres with a fake Stripe Connect: onboarding, account
 * sync, sending (claims, retries, interrupted attempts), the scheduled run,
 * manual payments and reversals. Runs only when TEST_DATABASE_URL points at a
 * disposable database (tables are truncated).
 */
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import type { EmailMessage, Mailer } from "@/lib/email";
import type { ConnectAccountState } from "./accounts";
import {
  dashboardLink,
  markAccountDisconnected,
  markPayoutPaidManually,
  payoutAccountStatus,
  PayoutError,
  payoutsOverview,
  recordTransferReversal,
  refreshPayoutAccount,
  runPayouts,
  sendPayout,
  startOnboarding,
  syncPayoutAccount,
  TransferError,
  type PayoutGateway,
} from "./service";

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-10T16:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 3_600_000);
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

class RecordingMailer implements Mailer {
  sent: EmailMessage[] = [];
  fail = false;
  async send(message: EmailMessage) {
    if (this.fail) throw new Error("mail down");
    this.sent.push(message);
  }
}

const ready = (id: string): ConnectAccountState => ({
  stripeAccountId: id,
  detailsSubmitted: true,
  payoutsEnabled: true,
  transfersActive: true,
  requirementsDue: [],
  disabledReason: null,
});

class FakeConnect implements PayoutGateway {
  accounts = new Map<string, ConnectAccountState>();
  created: { userId: string; idempotencyKey: string }[] = [];
  transfers: { id: string; payoutId: string; stripeAccountId: string; amountCents: number; idempotencyKey: string; reversed: boolean }[] = [];
  /** Errors to throw from the next createTransfer calls, in order. */
  failures: Error[] = [];
  /** Make the next transfer succeed at Stripe, then throw as if the response was lost. */
  loseNextResponse = false;

  async createAccount(input: { userId: string; email: string; name: string; idempotencyKey: string }) {
    this.created.push({ userId: input.userId, idempotencyKey: input.idempotencyKey });
    const state = { ...ready(`acct_${this.created.length}`), detailsSubmitted: false, payoutsEnabled: false, transfersActive: false, requirementsDue: ["external_account"] };
    this.accounts.set(state.stripeAccountId, state);
    return state;
  }
  async retrieveAccount(id: string) {
    return this.accounts.get(id)!;
  }
  async onboardingLink(id: string) {
    return `https://connect.test/onboard/${id}`;
  }
  async dashboardLink(id: string) {
    return `https://connect.test/express/${id}`;
  }
  async findTransfer(payoutId: string) {
    const t = this.transfers.find((x) => x.payoutId === payoutId && !x.reversed) ?? this.transfers.find((x) => x.payoutId === payoutId);
    return t ? { id: t.id, reversed: t.reversed } : null;
  }
  async createTransfer(input: { payoutId: string; stripeAccountId: string; amountCents: number; idempotencyKey: string }) {
    const failure = this.failures.shift();
    if (failure) throw failure;
    const existing = this.transfers.find((t) => t.idempotencyKey === input.idempotencyKey);
    if (existing) return { id: existing.id };
    const transfer = { ...input, id: `tr_${this.transfers.length + 1}`, reversed: false };
    this.transfers.push(transfer);
    if (this.loseNextResponse) {
      this.loseNextResponse = false;
      throw new TransferError("Connection reset", true);
    }
    return { id: transfer.id };
  }
}

describe.skipIf(!url)("payouts (Postgres)", () => {
  let client: postgres.Sql;
  let db: Database;
  let connect: FakeConnect;
  let mailer: RecordingMailer;
  const notifier = () => ({ mailer, earningsUrl: "https://fs.test/studio/earnings" });
  const james = { id: "james", email: "james@test.dev", name: "James" };
  const urls = { returnUrl: "https://fs.test/return", refreshUrl: "https://fs.test/refresh" };

  beforeAll(async () => {
    client = postgres(url!, { max: 4, onnotice: () => {} });
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: "drizzle" });
  });

  afterAll(async () => {
    await client?.end();
  });

  beforeEach(async () => {
    await db.execute(sql`truncate creator_payout_accounts, creator_payouts, pool_calculations, "user" cascade`);
    await db.insert(schema.user).values([
      { id: "james", name: "James", email: "james@test.dev", role: "creator" },
      { id: "marcus", name: "Marcus", email: "marcus@test.dev", role: "creator" },
      { id: "admin", name: "Ada", email: "admin@test.dev", role: "admin" },
    ]);
    connect = new FakeConnect();
    mailer = new RecordingMailer();
  });

  async function payout(creatorId: string, amountCents: number, createdAt = daysAgo(5)) {
    const [row] = await db
      .insert(schema.creatorPayouts)
      .values({ creatorId, amountCents, periodStart: new Date("2026-10-01T00:00:00Z"), periodEnd: new Date("2026-11-01T00:00:00Z"), createdAt })
      .returning();
    return row!;
  }
  const row = async (id: string) => (await db.query.creatorPayouts.findFirst({ where: eq(schema.creatorPayouts.id, id) }))!;

  async function readyAccount(userId: string, stripeAccountId = `acct_${userId}`) {
    await db.insert(schema.creatorPayoutAccounts).values({ userId, ...ready(stripeAccountId) });
    connect.accounts.set(stripeAccountId, ready(stripeAccountId));
  }

  describe("accounts", () => {
    it("creates one Express account and links to onboarding; returning continues the same account", async () => {
      expect(await payoutAccountStatus(db, "james")).toMatchObject({ readiness: "none" });
      expect(await startOnboarding(db, connect, james, urls)).toBe("https://connect.test/onboard/acct_1");
      expect(await startOnboarding(db, connect, james, urls)).toBe("https://connect.test/onboard/acct_1");
      expect(connect.created).toEqual([{ userId: "james", idempotencyKey: "connect-account-james-first" }]);
      expect(await payoutAccountStatus(db, "james")).toEqual({ readiness: "incomplete", requirementsDue: ["external_account"], disabledReason: null });
    });

    it("syncs Stripe's state, and refreshes it on demand", async () => {
      await startOnboarding(db, connect, james, urls);
      await expect(dashboardLink(db, connect, "james")).rejects.toBeInstanceOf(PayoutError);

      connect.accounts.set("acct_1", { ...ready("acct_1"), transfersActive: false });
      await refreshPayoutAccount(db, connect, "james");
      expect((await payoutAccountStatus(db, "james")).readiness).toBe("verifying");
      expect(await dashboardLink(db, connect, "james")).toBe("https://connect.test/express/acct_1");

      expect(await syncPayoutAccount(db, ready("acct_1"))).toBe(true);
      expect((await payoutAccountStatus(db, "james")).readiness).toBe("ready");
      expect(await syncPayoutAccount(db, ready("acct_unknown"))).toBe(false);
    });

    it("replaces a disconnected account with a new one", async () => {
      await startOnboarding(db, connect, james, urls);
      await markAccountDisconnected(db, "acct_1", NOW);
      expect((await payoutAccountStatus(db, "james")).readiness).toBe("disconnected");
      expect(await startOnboarding(db, connect, james, urls)).toBe("https://connect.test/onboard/acct_2");
      expect(connect.created[1]).toEqual({ userId: "james", idempotencyKey: "connect-account-james-acct_1" });
      expect((await payoutAccountStatus(db, "james")).readiness).toBe("incomplete");
    });
  });

  describe("sendPayout", () => {
    it("transfers to the creator's account, records it and emails them", async () => {
      await readyAccount("james");
      const p = await payout("james", 42_50);
      expect(await sendPayout(db, connect, p.id, { now: NOW, notifier: notifier() })).toEqual({ outcome: "paid", transferId: "tr_1" });
      expect(connect.transfers[0]).toMatchObject({ payoutId: p.id, stripeAccountId: "acct_james", amountCents: 42_50, idempotencyKey: `payout-${p.id}-1` });
      expect(await row(p.id)).toMatchObject({ status: "paid", stripeTransferId: "tr_1", attempts: 1, paidAt: NOW, failureReason: null });
      expect(mailer.sent.map((m) => [m.to, m.subject, m.idempotencyKey])).toEqual([
        ["james@test.dev", "Your Fatherhood.School payout of $42.50 is on its way", `payout-sent-${p.id}`],
      ]);
      expect(await sendPayout(db, connect, p.id, { now: NOW })).toEqual({ outcome: "skipped" });
      expect(connect.transfers).toHaveLength(1);
    });

    it("claims nothing while the creator's account isn't ready", async () => {
      const p = await payout("james", 30_00);
      expect(await sendPayout(db, connect, p.id, { now: NOW })).toEqual({ outcome: "not_ready", readiness: "none" });
      expect(await row(p.id)).toMatchObject({ status: "pending", attempts: 0 });
      await expect(sendPayout(db, connect, "00000000-0000-4000-8000-000000000000")).rejects.toBeInstanceOf(PayoutError);
    });

    it("sends once when two runs race for the same payout", async () => {
      await readyAccount("james");
      const p = await payout("james", 25_00);
      const results = await Promise.all([sendPayout(db, connect, p.id, { now: NOW }), sendPayout(db, connect, p.id, { now: NOW })]);
      expect(results.map((r) => r.outcome).sort()).toEqual(["paid", "skipped"]);
      expect(connect.transfers).toHaveLength(1);
    });

    it("keeps a payout pending after a temporary failure, then recovers a transfer whose response was lost", async () => {
      await readyAccount("james");
      const p = await payout("james", 25_00);
      connect.failures.push(new TransferError("Insufficient funds in Stripe account.", true));
      expect(await sendPayout(db, connect, p.id, { now: NOW })).toEqual({ outcome: "deferred", reason: "Insufficient funds in Stripe account." });
      expect(await row(p.id)).toMatchObject({ status: "pending", attempts: 1, failureReason: "Insufficient funds in Stripe account." });

      connect.loseNextResponse = true;
      expect((await sendPayout(db, connect, p.id, { now: NOW })).outcome).toBe("deferred");
      expect(connect.transfers).toHaveLength(1);

      // The third attempt finds the transfer Stripe made and records it instead of sending again.
      expect(await sendPayout(db, connect, p.id, { now: NOW })).toEqual({ outcome: "paid", transferId: "tr_1" });
      expect(connect.transfers).toHaveLength(1);
      expect(await row(p.id)).toMatchObject({ status: "paid", attempts: 3, stripeTransferId: "tr_1" });
    });

    it("reclaims an attempt that was interrupted, checking Stripe first", async () => {
      await readyAccount("james");
      const p = await payout("james", 25_00);
      // A crash after Stripe accepted the transfer, before we recorded it.
      connect.transfers.push({ id: "tr_9", payoutId: p.id, stripeAccountId: "acct_james", amountCents: 25_00, idempotencyKey: `payout-${p.id}-1`, reversed: false });
      await db.update(schema.creatorPayouts).set({ status: "processing", attempts: 1, lastAttemptAt: minutesAgo(5) }).where(eq(schema.creatorPayouts.id, p.id));

      expect(await sendPayout(db, connect, p.id, { now: NOW })).toEqual({ outcome: "skipped" }); // still inside the lease
      await db.update(schema.creatorPayouts).set({ lastAttemptAt: minutesAgo(30) }).where(eq(schema.creatorPayouts.id, p.id));
      expect(await sendPayout(db, connect, p.id, { now: NOW })).toEqual({ outcome: "paid", transferId: "tr_9" });
      expect(connect.transfers).toHaveLength(1);
    });

    it("fails a refused transfer; an admin's retry sends it", async () => {
      await readyAccount("james");
      const p = await payout("james", 25_00);
      connect.failures.push(new TransferError("Destination account is restricted.", false));
      expect(await sendPayout(db, connect, p.id, { now: NOW })).toEqual({ outcome: "failed", reason: "Destination account is restricted." });
      expect(await row(p.id)).toMatchObject({ status: "failed" });
      expect(await sendPayout(db, connect, p.id, { now: NOW })).toEqual({ outcome: "skipped" }); // automatic runs leave it
      expect((await sendPayout(db, connect, p.id, { now: NOW, manual: true })).outcome).toBe("paid");
    });
  });

  describe("runPayouts", () => {
    it("emails creators without a ready account once per payout, and sends nothing with auto-send off", async () => {
      await readyAccount("marcus");
      const waiting = await payout("james", 30_00);
      await payout("marcus", 20_00);

      expect(await runPayouts(db, connect, { now: NOW, autoSend: false, notifier: notifier() })).toEqual({ sent: 0, deferred: 0, failed: 0, waitingOnSetup: 1, reminded: 1 });
      expect(mailer.sent.map((m) => [m.to, m.subject, m.idempotencyKey])).toEqual([
        ["james@test.dev", "$30.00 is waiting for you on Fatherhood.School", `payout-setup-${waiting.id}`],
      ]);
      expect(mailer.sent[0]!.text).toContain("Set up payouts: https://fs.test/studio/earnings");
      expect((await runPayouts(db, connect, { now: NOW, autoSend: false, notifier: notifier() })).reminded).toBe(0);
      expect(connect.transfers).toHaveLength(0);
    });

    it("tries a reminder again on the next run when the email fails", async () => {
      const p = await payout("james", 30_00);
      mailer.fail = true;
      expect((await runPayouts(db, connect, { now: NOW, autoSend: false, notifier: notifier() })).reminded).toBe(0);
      expect((await row(p.id)).setupReminderSentAt).toBeNull();
      mailer.fail = false;
      expect((await runPayouts(db, connect, { now: NOW, autoSend: false, notifier: notifier() })).reminded).toBe(1);
    });

    it("sends ready payouts past their hold, oldest first", async () => {
      await readyAccount("james");
      await readyAccount("marcus");
      const old = await payout("james", 30_00, daysAgo(4));
      const fresh = await payout("marcus", 20_00, daysAgo(1));

      expect(await runPayouts(db, connect, { now: NOW, autoSend: true, notifier: notifier() })).toMatchObject({ sent: 1, waitingOnSetup: 0 });
      expect((await row(old.id)).status).toBe("paid");
      expect((await row(fresh.id)).status).toBe("pending");

      const later = new Date(NOW.getTime() + 3 * 24 * 3_600_000);
      expect((await runPayouts(db, connect, { now: later, autoSend: true, notifier: notifier() })).sent).toBe(1);
      expect((await row(fresh.id)).status).toBe("paid");
    });
  });

  it("records a payment made outside Stripe, but not twice or mid-send", async () => {
    const p = await payout("james", 30_00);
    await expect(markPayoutPaidManually(db, { payoutId: p.id, adminId: "admin", note: "  " })).rejects.toThrow("Say how it was paid");
    await markPayoutPaidManually(db, { payoutId: p.id, adminId: "admin", note: "Check #1042", now: NOW });
    expect(await row(p.id)).toMatchObject({ status: "paid", markedPaidById: "admin", manualNote: "Check #1042", paidAt: NOW });
    await expect(markPayoutPaidManually(db, { payoutId: p.id, adminId: "admin", note: "again" })).rejects.toThrow("already paid");

    const sending = await payout("james", 30_00);
    await db.update(schema.creatorPayouts).set({ status: "processing" }).where(eq(schema.creatorPayouts.id, sending.id));
    await expect(markPayoutPaidManually(db, { payoutId: sending.id, adminId: "admin", note: "x" })).rejects.toThrow("being sent");
  });

  it("returns a fully reversed transfer to failed, and notes a partial one", async () => {
    await readyAccount("james");
    const p = await payout("james", 30_00);
    await sendPayout(db, connect, p.id, { now: NOW });

    await recordTransferReversal(db, { id: "tr_1", amountCents: 30_00, amountReversedCents: 10_00 });
    expect(await row(p.id)).toMatchObject({ status: "paid", failureReason: "$10.00 of the transfer was reversed in Stripe." });

    await recordTransferReversal(db, { id: "tr_1", amountCents: 30_00, amountReversedCents: 30_00 });
    expect(await row(p.id)).toMatchObject({ status: "failed", paidAt: null, failureReason: "The transfer was reversed in Stripe." });

    // A retry looks past the reversed transfer and sends a new one.
    connect.transfers[0]!.reversed = true;
    expect(await sendPayout(db, connect, p.id, { now: NOW, manual: true })).toEqual({ outcome: "paid", transferId: "tr_2" });
  });

  it("summarizes what is owed for the admin page", async () => {
    await readyAccount("marcus");
    await payout("james", 30_00, daysAgo(1));
    const failed = await payout("marcus", 20_00);
    await db.update(schema.creatorPayouts).set({ status: "failed", failureReason: "restricted" }).where(eq(schema.creatorPayouts.id, failed.id));
    const sent = await payout("marcus", 50_00);
    await sendPayout(db, connect, sent.id, { now: NOW });

    const overview = await payoutsOverview(db, { now: NOW });
    expect(overview.totals).toEqual({ openCents: 50_00, readyCents: 20_00, waitingOnSetupCents: 30_00, failedCount: 1 });
    // Oldest first; James's payout is a day old, so still inside the automatic hold.
    expect(overview.open.map((p) => [p.name, p.readiness, p.onHoldUntil !== null])).toEqual([
      ["Marcus", "ready", false],
      ["James", "none", true],
    ]);
    expect(overview.paid.map((p) => [p.name, p.stripeTransferId])).toEqual([["Marcus", "tr_1"]]);
  });
});
