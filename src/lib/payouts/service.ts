/**
 * Creator payouts with Stripe Connect.
 *
 * Settlement (lib/revenue/settlement.ts) records each payout as "pending". This module
 * onboards creators to Express accounts and sends pending payouts as Stripe transfers.
 * Stripe then pays the money out to the creator's bank on their payout schedule.
 *
 * Sending is safe to retry and to run twice at once:
 * - an attempt first claims the payout (pending -> processing) with a conditional update;
 * - every attempt has its own idempotency key, and from the second attempt on we first ask
 *   Stripe for a transfer already made for the payout (transfer_group = payout id), so an
 *   attempt interrupted after Stripe accepted it is recorded, never paid twice;
 * - a "processing" payout whose attempt is older than the lease is reclaimed and checked.
 */
import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { creatorPayoutAccounts, creatorPayouts, poolCalculations, user, type PayoutStatus } from "@/lib/db/schema";
import type { Mailer } from "@/lib/email";
import { payoutReadiness, type ConnectAccountState, type PayoutReadiness } from "./accounts";
import { payoutSentEmail, payoutSetupEmail } from "./emails";
import { PAYOUT_POLICY } from "./policy";

/** Stripe Connect, as the payout service needs it (Stripe in production, a fake in tests). */
export interface PayoutGateway {
  /** The idempotency key makes a double click create one account, not two. */
  createAccount(input: { userId: string; email: string; name: string; idempotencyKey: string }): Promise<ConnectAccountState>;
  retrieveAccount(stripeAccountId: string): Promise<ConnectAccountState>;
  onboardingLink(stripeAccountId: string, urls: { returnUrl: string; refreshUrl: string }): Promise<string>;
  dashboardLink(stripeAccountId: string): Promise<string>;
  /** A transfer already made for this payout, if any. */
  findTransfer(payoutId: string): Promise<{ id: string; reversed: boolean } | null>;
  createTransfer(input: { payoutId: string; stripeAccountId: string; amountCents: number; description: string; idempotencyKey: string }): Promise<{ id: string }>;
}

/** A transfer Stripe did not make. Retryable failures (Stripe balance not yet available, outages) are tried again later. */
export class TransferError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export class PayoutError extends Error {
  constructor(
    readonly reason: "not_found" | "not_ready" | "not_allowed",
    message: string,
  ) {
    super(message);
  }
}

export type PayoutNotifier = { mailer: Mailer; earningsUrl: string };

const minutesAgo = (now: Date, minutes: number) => new Date(now.getTime() - minutes * 60_000);
const daysAgo = (now: Date, days: number) => new Date(now.getTime() - days * 24 * 3_600_000);

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export async function getPayoutAccount(db: Database, userId: string) {
  return (await db.query.creatorPayoutAccounts.findFirst({ where: eq(creatorPayoutAccounts.userId, userId) })) ?? null;
}

/** The creator's account and where they stand, for the Studio. */
export async function payoutAccountStatus(db: Database, userId: string): Promise<{ readiness: PayoutReadiness; requirementsDue: string[]; disabledReason: string | null }> {
  const account = await getPayoutAccount(db, userId);
  return { readiness: payoutReadiness(account), requirementsDue: account?.requirementsDue ?? [], disabledReason: account?.disabledReason ?? null };
}

/**
 * Start or continue Stripe onboarding: creates the creator's Express account the first
 * time (or again after they disconnected it) and returns a one-time onboarding link.
 */
export async function startOnboarding(
  db: Database,
  gateway: PayoutGateway,
  creator: { id: string; email: string; name: string },
  urls: { returnUrl: string; refreshUrl: string },
): Promise<string> {
  let account = await getPayoutAccount(db, creator.id);
  if (!account || account.disconnectedAt) {
    const state = await gateway.createAccount({
      userId: creator.id,
      email: creator.email,
      name: creator.name,
      idempotencyKey: `connect-account-${creator.id}-${account?.stripeAccountId ?? "first"}`,
    });
    const values = { ...state, disconnectedAt: null };
    await db
      .insert(creatorPayoutAccounts)
      .values({ userId: creator.id, ...values })
      // A disconnected account is replaced; a live one (a concurrent first click) is kept.
      .onConflictDoUpdate({ target: creatorPayoutAccounts.userId, set: values, setWhere: isNotNull(creatorPayoutAccounts.disconnectedAt) });
    account = (await getPayoutAccount(db, creator.id))!;
  }
  return gateway.onboardingLink(account.stripeAccountId, urls);
}

/** A sign-in link to the creator's Stripe Express dashboard (bank details, deposits, tax forms). */
export async function dashboardLink(db: Database, gateway: PayoutGateway, userId: string): Promise<string> {
  const account = await getPayoutAccount(db, userId);
  if (!account || account.disconnectedAt || !account.detailsSubmitted) throw new PayoutError("not_ready", "Finish setting up payouts first.");
  return gateway.dashboardLink(account.stripeAccountId);
}

/** Store Stripe's latest state for an account (account.updated, or on return from onboarding). False if it isn't ours. */
export async function syncPayoutAccount(db: Database, state: ConnectAccountState): Promise<boolean> {
  const { stripeAccountId, ...fields } = state;
  const updated = await db
    .update(creatorPayoutAccounts)
    .set(fields)
    .where(eq(creatorPayoutAccounts.stripeAccountId, stripeAccountId))
    .returning({ userId: creatorPayoutAccounts.userId });
  return updated.length > 0;
}

/** Fetch and store the account's state from Stripe now, rather than waiting for the webhook. */
export async function refreshPayoutAccount(db: Database, gateway: PayoutGateway, userId: string): Promise<void> {
  const account = await getPayoutAccount(db, userId);
  if (!account || account.disconnectedAt) return;
  await syncPayoutAccount(db, await gateway.retrieveAccount(account.stripeAccountId));
}

/** The creator removed our platform's access to their account. */
export async function markAccountDisconnected(db: Database, stripeAccountId: string, now: Date = new Date()): Promise<void> {
  await db
    .update(creatorPayoutAccounts)
    .set({ disconnectedAt: now, payoutsEnabled: false, transfersActive: false })
    .where(eq(creatorPayoutAccounts.stripeAccountId, stripeAccountId));
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export type SendOutcome =
  | { outcome: "paid"; transferId: string }
  | { outcome: "deferred"; reason: string }
  | { outcome: "failed"; reason: string }
  | { outcome: "not_ready"; readiness: PayoutReadiness }
  | { outcome: "skipped" };

async function loadPayout(db: Database, payoutId: string) {
  const [row] = await db
    .select({ payout: creatorPayouts, account: creatorPayoutAccounts, name: user.name, email: user.email })
    .from(creatorPayouts)
    .innerJoin(user, eq(user.id, creatorPayouts.creatorId))
    .leftJoin(creatorPayoutAccounts, eq(creatorPayoutAccounts.userId, creatorPayouts.creatorId))
    .where(eq(creatorPayouts.id, payoutId));
  return row ?? null;
}

/**
 * Send one payout. Automatic runs send pending payouts (and reclaim stale attempts);
 * `manual` (an admin's "Send now") also retries a failed payout. Nothing is claimed
 * unless the creator's account is ready to receive money.
 */
export async function sendPayout(
  db: Database,
  gateway: PayoutGateway,
  payoutId: string,
  options: { now?: Date; manual?: boolean; notifier?: PayoutNotifier } = {},
): Promise<SendOutcome> {
  const now = options.now ?? new Date();
  const row = await loadPayout(db, payoutId);
  if (!row) throw new PayoutError("not_found", "Payout not found.");
  const { payout, account } = row;
  if (payout.status === "paid") return { outcome: "skipped" };

  const readiness = payoutReadiness(account);
  if (readiness !== "ready" || !account) return { outcome: "not_ready", readiness };

  const claimable: PayoutStatus[] = options.manual ? ["pending", "failed"] : ["pending"];
  const [claimed] = await db
    .update(creatorPayouts)
    .set({ status: "processing", attempts: sql`${creatorPayouts.attempts} + 1`, lastAttemptAt: now })
    .where(
      and(
        eq(creatorPayouts.id, payoutId),
        or(
          inArray(creatorPayouts.status, claimable),
          and(eq(creatorPayouts.status, "processing"), lte(creatorPayouts.lastAttemptAt, minutesAgo(now, PAYOUT_POLICY.attemptLeaseMinutes))),
        ),
      ),
    )
    .returning({ attempts: creatorPayouts.attempts });
  if (!claimed) return { outcome: "skipped" }; // another run has it, or it isn't sendable

  const markPaid = async (transferId: string) => {
    await db
      .update(creatorPayouts)
      .set({ status: "paid", stripeTransferId: transferId, paidAt: now, failureReason: null })
      .where(eq(creatorPayouts.id, payoutId));
    if (options.notifier) {
      const { mailer, earningsUrl } = options.notifier;
      await mailer
        .send({ ...payoutSentEmail({ name: row.name, email: row.email, amountCents: payout.amountCents, earningsUrl }), idempotencyKey: `payout-sent-${payoutId}` })
        .catch((error: unknown) => console.error(`Payout ${payoutId}: sent email failed`, error));
    }
    return { outcome: "paid" as const, transferId };
  };

  try {
    // A previous attempt may have reached Stripe before it was interrupted.
    if (claimed.attempts > 1) {
      const existing = await gateway.findTransfer(payoutId);
      if (existing && !existing.reversed) return await markPaid(existing.id);
    }
    const transfer = await gateway.createTransfer({
      payoutId,
      stripeAccountId: account.stripeAccountId,
      amountCents: payout.amountCents,
      description: `Fatherhood.School creator pool payout`,
      idempotencyKey: `payout-${payoutId}-${claimed.attempts}`,
    });
    return await markPaid(transfer.id);
  } catch (error) {
    const retryable = error instanceof TransferError ? error.retryable : true;
    const reason = error instanceof Error ? error.message : String(error);
    if (!(error instanceof TransferError)) console.error(`Payout ${payoutId}: transfer attempt failed`, error);
    await db
      .update(creatorPayouts)
      .set({ status: retryable ? "pending" : "failed", failureReason: reason })
      .where(eq(creatorPayouts.id, payoutId));
    return retryable ? { outcome: "deferred", reason } : { outcome: "failed", reason };
  }
}

export type PayoutRunResult = { sent: number; deferred: number; failed: number; waitingOnSetup: number; reminded: number };

/**
 * The scheduled run: asks creators without a ready account to set one up (once per
 * payout), then, when `autoSend` is on, sends every pending payout past its hold whose
 * creator is ready, and reclaims attempts that were interrupted.
 */
export async function runPayouts(
  db: Database,
  gateway: PayoutGateway,
  options: { now?: Date; autoSend: boolean; notifier: PayoutNotifier },
): Promise<PayoutRunResult> {
  const now = options.now ?? new Date();
  const result: PayoutRunResult = { sent: 0, deferred: 0, failed: 0, waitingOnSetup: 0, reminded: 0 };

  const waiting = await db
    .select({ payout: creatorPayouts, account: creatorPayoutAccounts, name: user.name, email: user.email })
    .from(creatorPayouts)
    .innerJoin(user, eq(user.id, creatorPayouts.creatorId))
    .leftJoin(creatorPayoutAccounts, eq(creatorPayoutAccounts.userId, creatorPayouts.creatorId))
    .where(eq(creatorPayouts.status, "pending"))
    .orderBy(asc(creatorPayouts.createdAt));
  for (const row of waiting) {
    if (payoutReadiness(row.account) === "ready") continue;
    result.waitingOnSetup++;
    if (row.payout.setupReminderSentAt) continue;
    const [claimed] = await db
      .update(creatorPayouts)
      .set({ setupReminderSentAt: now })
      .where(and(eq(creatorPayouts.id, row.payout.id), isNull(creatorPayouts.setupReminderSentAt)))
      .returning({ id: creatorPayouts.id });
    if (!claimed) continue;
    const email = payoutSetupEmail({
      name: row.name,
      email: row.email,
      amountCents: row.payout.amountCents,
      earningsUrl: options.notifier.earningsUrl,
      started: Boolean(row.account),
    });
    try {
      await options.notifier.mailer.send({ ...email, idempotencyKey: `payout-setup-${row.payout.id}` });
      result.reminded++;
    } catch (error) {
      console.error(`Payout ${row.payout.id}: setup reminder failed`, error);
      await db.update(creatorPayouts).set({ setupReminderSentAt: null }).where(eq(creatorPayouts.id, row.payout.id));
    }
  }

  if (!options.autoSend) return result;

  const due = await db
    .select({ id: creatorPayouts.id })
    .from(creatorPayouts)
    .innerJoin(creatorPayoutAccounts, eq(creatorPayoutAccounts.userId, creatorPayouts.creatorId))
    .where(
      and(
        eq(creatorPayoutAccounts.transfersActive, true),
        eq(creatorPayoutAccounts.payoutsEnabled, true),
        isNull(creatorPayoutAccounts.disconnectedAt),
        or(
          and(eq(creatorPayouts.status, "pending"), lte(creatorPayouts.createdAt, daysAgo(now, PAYOUT_POLICY.holdDays))),
          and(eq(creatorPayouts.status, "processing"), lte(creatorPayouts.lastAttemptAt, minutesAgo(now, PAYOUT_POLICY.attemptLeaseMinutes))),
        ),
      ),
    )
    .orderBy(asc(creatorPayouts.createdAt))
    .limit(PAYOUT_POLICY.maxPerRun);
  for (const { id } of due) {
    const sent = await sendPayout(db, gateway, id, { now, notifier: options.notifier });
    if (sent.outcome === "paid") result.sent++;
    else if (sent.outcome === "deferred") result.deferred++;
    else if (sent.outcome === "failed") result.failed++;
  }
  return result;
}

/** Record a payment made outside Stripe Connect (a check, a bank transfer). */
export async function markPayoutPaidManually(
  db: Database,
  input: { payoutId: string; adminId: string; note: string; now?: Date },
): Promise<void> {
  const note = input.note.trim();
  if (!note) throw new PayoutError("not_allowed", "Say how it was paid (for example, check number or bank reference).");
  const updated = await db
    .update(creatorPayouts)
    .set({ status: "paid", paidAt: input.now ?? new Date(), markedPaidById: input.adminId, manualNote: note, failureReason: null })
    .where(and(eq(creatorPayouts.id, input.payoutId), inArray(creatorPayouts.status, ["pending", "failed"])))
    .returning({ id: creatorPayouts.id });
  if (updated.length === 0) {
    const exists = await db.query.creatorPayouts.findFirst({ where: eq(creatorPayouts.id, input.payoutId), columns: { status: true } });
    if (!exists) throw new PayoutError("not_found", "Payout not found.");
    throw new PayoutError("not_allowed", exists.status === "paid" ? "This payout is already paid." : "This payout is being sent right now.");
  }
}

/** A transfer was reversed in Stripe. A full reversal returns the payout to "failed" for an admin to retry. */
export async function recordTransferReversal(
  db: Database,
  transfer: { id: string; amountCents: number; amountReversedCents: number },
): Promise<void> {
  const full = transfer.amountReversedCents >= transfer.amountCents;
  const reversed = (transfer.amountReversedCents / 100).toFixed(2);
  await db
    .update(creatorPayouts)
    .set(
      full
        ? { status: "failed", paidAt: null, failureReason: "The transfer was reversed in Stripe." }
        : { failureReason: `$${reversed} of the transfer was reversed in Stripe.` },
    )
    .where(eq(creatorPayouts.stripeTransferId, transfer.id));
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

/** Every payout that isn't paid, then the latest paid ones; with each creator's readiness and recent settlements. */
export async function payoutsOverview(db: Database, options: { now?: Date; recentPaid?: number } = {}) {
  const now = options.now ?? new Date();
  const select = {
    id: creatorPayouts.id,
    creatorId: creatorPayouts.creatorId,
    name: user.name,
    email: user.email,
    amountCents: creatorPayouts.amountCents,
    status: creatorPayouts.status,
    periodStart: creatorPayouts.periodStart,
    periodEnd: creatorPayouts.periodEnd,
    failureReason: creatorPayouts.failureReason,
    attempts: creatorPayouts.attempts,
    stripeTransferId: creatorPayouts.stripeTransferId,
    manualNote: creatorPayouts.manualNote,
    paidAt: creatorPayouts.paidAt,
    createdAt: creatorPayouts.createdAt,
    account: creatorPayoutAccounts,
  };
  const base = () =>
    db
      .select(select)
      .from(creatorPayouts)
      .innerJoin(user, eq(user.id, creatorPayouts.creatorId))
      .leftJoin(creatorPayoutAccounts, eq(creatorPayoutAccounts.userId, creatorPayouts.creatorId));
  const [open, paid, settlements] = await Promise.all([
    base().where(inArray(creatorPayouts.status, ["pending", "processing", "failed"])).orderBy(asc(creatorPayouts.createdAt)),
    base()
      .where(eq(creatorPayouts.status, "paid"))
      .orderBy(desc(creatorPayouts.paidAt))
      .limit(options.recentPaid ?? 25),
    db
      .select({
        id: poolCalculations.id,
        periodStart: poolCalculations.periodStart,
        subscriptionRevenueCents: poolCalculations.subscriptionRevenueCents,
        poolCents: poolCalculations.poolCents,
        eligibleCreators: poolCalculations.eligibleCreators,
        completedAt: poolCalculations.completedAt,
      })
      .from(poolCalculations)
      .where(eq(poolCalculations.status, "completed"))
      .orderBy(desc(poolCalculations.periodStart))
      .limit(12),
  ]);

  const holdCutoff = daysAgo(now, PAYOUT_POLICY.holdDays);
  const shape = ({ account, ...p }: (typeof open)[number]) => {
    const readiness = payoutReadiness(account);
    return { ...p, readiness, onHoldUntil: p.status === "pending" && p.createdAt > holdCutoff ? new Date(p.createdAt.getTime() + PAYOUT_POLICY.holdDays * 24 * 3_600_000) : null };
  };
  const openRows = open.map(shape);
  const sum = (rows: { amountCents: number }[]) => rows.reduce((t, r) => t + r.amountCents, 0);
  return {
    open: openRows,
    paid: paid.map(shape),
    settlements,
    totals: {
      openCents: sum(openRows),
      readyCents: sum(openRows.filter((r) => r.readiness === "ready" && r.status !== "processing")),
      waitingOnSetupCents: sum(openRows.filter((r) => r.readiness !== "ready")),
      failedCount: openRows.filter((r) => r.status === "failed").length,
    },
  };
}
