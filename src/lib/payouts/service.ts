/**
 * Creator payouts over Stripe Connect (docs/development-plan.md Phase 2:
 * automated payouts). Settlement (lib/revenue/settlement.ts) records each
 * payout as pending; this module connects creators' Stripe accounts and sends
 * the money as transfers.
 *
 * Never paying twice: a payout is claimed before it's sent (status
 * "processing" with a lease), every transfer carries the payout's
 * transfer_group, and each attempt first asks Stripe whether that group
 * already has a transfer (an earlier attempt that succeeded but wasn't
 * recorded) before creating one with an idempotency key.
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { creatorPayouts, payoutAccounts, user } from "@/lib/db/schema";
import type { Mailer } from "@/lib/email";
import { transferFailureReason, type AccountState, type ConnectGateway } from "./gateway";
import { payoutSentEmail, payoutSetupEmail } from "./emails";

export const PAYOUT_POLICY = {
  /** Connect accounts are created in this country (Stripe Express). */
  country: "US",
  /** Failed transfers retry automatically this many times, this far apart. */
  maxAttempts: 5,
  retryAfterHours: 6,
  /** A payout stuck "processing" this long (the sender crashed) is picked up again. */
  staleProcessingMinutes: 30,
  /** Reminders to set up a payout account, at most this often. */
  setupReminderDays: 7,
  batchSize: 50,
} as const;

export class PayoutError extends Error {
  constructor(
    readonly reason: "not_found" | "no_account" | "not_allowed",
    message: string,
  ) {
    super(message);
    this.name = "PayoutError";
  }
}

export type PayoutAccount = typeof payoutAccounts.$inferSelect;

export async function payoutAccount(db: Database, userId: string): Promise<PayoutAccount | null> {
  const [row] = await db.select().from(payoutAccounts).where(eq(payoutAccounts.userId, userId));
  return row ?? null;
}

/** Store Stripe's view of an account (from a webhook, or after onboarding). */
export async function applyAccountState(db: Database, state: AccountState, now: Date = new Date()) {
  const [row] = await db
    .update(payoutAccounts)
    .set({
      detailsSubmitted: state.detailsSubmitted,
      payoutsEnabled: state.payoutsEnabled,
      requirementsDue: state.requirementsDue,
      disabledReason: state.disabledReason,
      country: state.country,
      updatedAt: now,
    })
    .where(eq(payoutAccounts.stripeAccountId, state.id))
    .returning();
  return row ?? null;
}

/** The creator disconnected their account from the platform in Stripe. */
export async function markDisconnected(db: Database, stripeAccountId: string, now: Date = new Date()) {
  await db
    .update(payoutAccounts)
    .set({ payoutsEnabled: false, disabledReason: "disconnected", updatedAt: now })
    .where(eq(payoutAccounts.stripeAccountId, stripeAccountId));
}

/** Create the creator's Connect account if needed, and return a Stripe onboarding link. */
export async function startOnboarding(
  db: Database,
  gateway: ConnectGateway,
  creator: { id: string; email: string },
  urls: { refreshUrl: string; returnUrl: string },
): Promise<string> {
  let account = await payoutAccount(db, creator.id);
  if (!account) {
    const state = await gateway.createAccount({ userId: creator.id, email: creator.email, country: PAYOUT_POLICY.country });
    await db
      .insert(payoutAccounts)
      .values({
        userId: creator.id,
        stripeAccountId: state.id,
        detailsSubmitted: state.detailsSubmitted,
        payoutsEnabled: state.payoutsEnabled,
        requirementsDue: state.requirementsDue,
        disabledReason: state.disabledReason,
        country: state.country,
      })
      .onConflictDoNothing({ target: payoutAccounts.userId });
    account = (await payoutAccount(db, creator.id))!;
  }
  return gateway.onboardingLink(account.stripeAccountId, urls);
}

/** Refresh the stored account from Stripe (when the creator returns from onboarding). */
export async function refreshAccount(db: Database, gateway: ConnectGateway, userId: string) {
  const account = await payoutAccount(db, userId);
  if (!account) return null;
  return applyAccountState(db, await gateway.retrieveAccount(account.stripeAccountId));
}

/** A one-time link into the creator's Stripe Express dashboard. */
export async function dashboardLink(db: Database, gateway: ConnectGateway, userId: string): Promise<string> {
  const account = await payoutAccount(db, userId);
  if (!account?.detailsSubmitted) throw new PayoutError("no_account", "Set up payouts first.");
  return gateway.dashboardLink(account.stripeAccountId);
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

type Claimed = { id: string; creatorId: string; amountCents: number; attempts: number; periodStart: Date; periodEnd: Date; stripeAccountId: string };

const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`;
const minutes = (n: number) => sql.raw(`make_interval(mins => ${Number(n)})`);

/**
 * Claim payouts that can be sent now: pending ones, failed ones due a retry,
 * and ones left "processing" by a crashed run, for creators whose account can
 * receive transfers.
 */
async function claim(db: Database, now: Date, options: { ids?: string[]; limit: number }): Promise<Claimed[]> {
  const P = PAYOUT_POLICY;
  // An admin sending specific payouts skips the automatic retry wait.
  const retryable = options.ids?.length
    ? sql`p.status = 'failed'`
    : sql`(p.status = 'failed' and p.attempts < ${sql.raw(String(P.maxAttempts))} and p.last_attempt_at <= ${ts(now)} - ${minutes(P.retryAfterHours * 60)})`;
  const only = options.ids?.length ? sql`and p.id in (${sql.join(options.ids.map((id) => sql`${id}::uuid`), sql`, `)})` : sql``;
  const rows = await db.execute<{
    id: string;
    creator_id: string;
    amount_cents: number;
    attempts: number;
    period_start: string;
    period_end: string;
    stripe_account_id: string;
  }>(sql`
    with due as (
      select p.id from creator_payouts p
      join payout_accounts a on a.user_id = p.creator_id and a.payouts_enabled
      where (p.status = 'pending' or ${retryable}
        or (p.status = 'processing' and p.last_attempt_at <= ${ts(now)} - ${minutes(P.staleProcessingMinutes)}))
        ${only}
      order by p.created_at
      limit ${options.limit}
      for update of p skip locked
    )
    update creator_payouts p set status = 'processing', attempts = p.attempts + 1, last_attempt_at = ${ts(now)}, updated_at = ${ts(now)}
    from due, payout_accounts a
    where p.id = due.id and a.user_id = p.creator_id
    returning p.id, p.creator_id, p.amount_cents, p.attempts, p.period_start, p.period_end, a.stripe_account_id
  `);
  return rows.map((r) => ({
    id: r.id,
    creatorId: r.creator_id,
    amountCents: Number(r.amount_cents),
    attempts: Number(r.attempts),
    periodStart: new Date(r.period_start),
    periodEnd: new Date(r.period_end),
    stripeAccountId: r.stripe_account_id,
  }));
}

const monthLabel = (d: Date) => d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

export type SendResult = {
  paid: { id: string; creatorId: string; amountCents: number; transferId: string }[];
  failed: { id: string; creatorId: string; amountCents: number; reason: string }[];
};

export type SendOptions = {
  now?: Date;
  /** Send only these payouts (failed ones included, without waiting for the retry delay). */
  ids?: string[];
  /** Emails the creator once a payout is sent. */
  notify?: { mailer: Mailer; appUrl: string };
};

export async function sendPayouts(db: Database, gateway: ConnectGateway, options: SendOptions = {}): Promise<SendResult> {
  const now = options.now ?? new Date();
  const claimed = await claim(db, now, { ids: options.ids, limit: PAYOUT_POLICY.batchSize });
  const result: SendResult = { paid: [], failed: [] };

  for (const payout of claimed) {
    const group = `payout_${payout.id}`;
    try {
      const transfer =
        (await gateway.findTransfer(group)) ??
        (await gateway.createTransfer({
          amountCents: payout.amountCents,
          destination: payout.stripeAccountId,
          group,
          description: `Fatherhood.School creator pool, ${monthLabel(payout.periodStart)}–${monthLabel(new Date(payout.periodEnd.getTime() - 1))}`,
          metadata: { payoutId: payout.id, creatorId: payout.creatorId },
          idempotencyKey: `${group}_attempt_${payout.attempts}`,
        }));
      await db
        .update(creatorPayouts)
        .set({ status: "paid", stripeTransferId: transfer.id, paidAt: now, failureReason: null, updatedAt: now })
        .where(eq(creatorPayouts.id, payout.id));
      result.paid.push({ id: payout.id, creatorId: payout.creatorId, amountCents: payout.amountCents, transferId: transfer.id });
    } catch (error) {
      const reason = transferFailureReason(error);
      await db.update(creatorPayouts).set({ status: "failed", failureReason: reason, updatedAt: now }).where(eq(creatorPayouts.id, payout.id));
      result.failed.push({ id: payout.id, creatorId: payout.creatorId, amountCents: payout.amountCents, reason });
    }
  }

  if (options.notify && result.paid.length) {
    const people = await db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(user)
      .where(sql`${user.id} in (${sql.join(result.paid.map((p) => sql`${p.creatorId}`), sql`, `)})`);
    for (const p of result.paid) {
      const person = people.find((x) => x.id === p.creatorId);
      if (!person) continue;
      await options.notify.mailer
        .send(
          payoutSentEmail({
            to: person.email,
            name: person.name,
            amountCents: p.amountCents,
            earningsUrl: `${options.notify.appUrl}/studio/earnings`,
            idempotencyKey: `payout-sent-${p.id}`,
          }),
        )
        .catch((error) => console.error(`Payout email failed for ${p.id}:`, error));
    }
  }
  return result;
}

/**
 * Remind creators with money waiting, and no account ready for it, to set up
 * payouts: one email per creator with their total, at most once a week.
 * Returns how many creators were reminded.
 */
export async function remindAccountSetup(db: Database, mailer: Mailer, appUrl: string, now: Date = new Date()): Promise<number> {
  const rows = await db.execute<{ creator_id: string; amount_cents: number; email: string; name: string }>(sql`
    update creator_payouts p set setup_reminder_at = ${ts(now)}
    from "user" u
    where u.id = p.creator_id and p.status = 'pending'
      and not exists (select 1 from payout_accounts a where a.user_id = p.creator_id and a.payouts_enabled)
      and (p.setup_reminder_at is null or p.setup_reminder_at <= ${ts(now)} - ${minutes(PAYOUT_POLICY.setupReminderDays * 24 * 60)})
    returning p.creator_id, p.amount_cents, u.email, u.name
  `);
  const byCreator = new Map<string, { email: string; name: string; cents: number }>();
  for (const r of rows) {
    const entry = byCreator.get(r.creator_id) ?? { email: r.email, name: r.name, cents: 0 };
    entry.cents += Number(r.amount_cents);
    byCreator.set(r.creator_id, entry);
  }
  for (const [creatorId, c] of byCreator) {
    await mailer
      .send(payoutSetupEmail({ to: c.email, name: c.name, amountCents: c.cents, earningsUrl: `${appUrl}/studio/earnings#payouts` }))
      .catch((error) => console.error(`Payout setup reminder failed for ${creatorId}:`, error));
  }
  return byCreator.size;
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export type QueueRow = Awaited<ReturnType<typeof payoutQueue>>[number];

/** Every payout not yet paid, plus recent paid ones, with each creator's account state. */
export async function payoutQueue(db: Database, options: { paidLimit?: number } = {}) {
  const base = db
    .select({
      payout: creatorPayouts,
      creatorName: user.name,
      creatorEmail: user.email,
      accountReady: sql<boolean>`coalesce(${payoutAccounts.payoutsEnabled}, false)`,
      accountStarted: sql<boolean>`${payoutAccounts.userId} is not null`,
      requirementsDue: payoutAccounts.requirementsDue,
    })
    .from(creatorPayouts)
    .innerJoin(user, eq(creatorPayouts.creatorId, user.id))
    .leftJoin(payoutAccounts, eq(payoutAccounts.userId, creatorPayouts.creatorId));
  const [open, paid] = await Promise.all([
    base.where(sql`${creatorPayouts.status} <> 'paid'`).orderBy(asc(creatorPayouts.createdAt)),
    db
      .select({
        payout: creatorPayouts,
        creatorName: user.name,
        creatorEmail: user.email,
        accountReady: sql<boolean>`true`,
        accountStarted: sql<boolean>`true`,
        requirementsDue: sql<string[] | null>`null`,
      })
      .from(creatorPayouts)
      .innerJoin(user, eq(creatorPayouts.creatorId, user.id))
      .where(eq(creatorPayouts.status, "paid"))
      .orderBy(desc(creatorPayouts.paidAt))
      .limit(options.paidLimit ?? 20),
  ]);
  return [...open, ...paid];
}

/** What a payout is waiting on, for people. */
export function payoutState(row: Pick<QueueRow, "accountReady" | "accountStarted"> & { payout: Pick<QueueRow["payout"], "status" | "attempts"> }) {
  const { status, attempts } = row.payout;
  if (status === "paid") return "paid" as const;
  if (status === "processing") return "sending" as const;
  if (!row.accountReady) return row.accountStarted ? ("account_incomplete" as const) : ("needs_account" as const);
  if (status === "failed") return attempts >= PAYOUT_POLICY.maxAttempts ? ("failed" as const) : ("retrying" as const);
  return "ready" as const;
}

export async function payoutTotals(db: Database) {
  const rows = await payoutQueue(db, { paidLimit: 0 });
  const sum = (filter: (r: QueueRow) => boolean) => {
    const list = rows.filter(filter);
    return { count: list.length, cents: list.reduce((s, r) => s + r.payout.amountCents, 0) };
  };
  return {
    ready: sum((r) => payoutState(r) === "ready" || payoutState(r) === "retrying"),
    waitingOnCreators: sum((r) => ["needs_account", "account_incomplete"].includes(payoutState(r))),
    failed: sum((r) => payoutState(r) === "failed"),
  };
}

/** Admin: put a failed payout back in the queue now (including one out of automatic retries). */
export async function requeuePayout(db: Database, id: string, now: Date = new Date()) {
  const [row] = await db
    .update(creatorPayouts)
    .set({ status: "pending", failureReason: null, updatedAt: now })
    .where(and(eq(creatorPayouts.id, id), eq(creatorPayouts.status, "failed")))
    .returning({ id: creatorPayouts.id });
  if (!row) throw new PayoutError("not_found", "Only failed payouts can be retried.");
}
