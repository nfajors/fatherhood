/**
 * Runs the email sequences: enrolls people whose situation matches a sequence,
 * then sends every step that's due. Called by /api/cron/email-sequences.
 *
 * Safe to run concurrently and to retry: due rows are claimed with a short
 * lease (skip locked), each email has a unique send key recorded in
 * email_sends, and that key doubles as Resend's idempotency key.
 */
import { eq, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { emailEnrollments, emailSends, type EmailCategory } from "@/lib/db/schema";
import type { Mailer } from "@/lib/email";
import { loadEmailContext, loadSharedContext, type SharedContext } from "./context";
import { EMAIL_POLICY as P } from "./policy";
import { getPreferences } from "./preferences";
import { SEQUENCES, type SequenceId } from "./sequences";
import { renderEmail } from "./template";
import { emailToken } from "./tokens";

const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`;
const days = (n: number) => sql.raw(`make_interval(days => ${Number(n)})`);
const MEMBER = (now: Date) =>
  sql`exists (select 1 from subscriptions s where s.user_id = u.id and s.status in ('active', 'trialing', 'past_due') and s.current_period_end > ${ts(now)})`;

/** Who each sequence is for, as SQL selecting user ids. */
function candidates(sequence: SequenceId, now: Date) {
  switch (sequence) {
    case "welcome":
      return sql`select u.id from "user" u where u.created_at >= ${ts(now)} - ${days(P.welcomeWindowDays)} and not ${MEMBER(now)}`;
    case "member_onboarding":
      return sql`select u.id from "user" u where ${MEMBER(now)}
        and (select min(s.created_at) from subscriptions s where s.user_id = u.id) >= ${ts(now)} - ${days(P.onboardingWindowDays)}`;
    case "reengagement":
      return sql`select u.id from "user" u where ${MEMBER(now)}
        -- Timed from the latest membership start, so someone who just rejoined isn't nudged straight away.
        and (select max(s.created_at) from subscriptions s where s.user_id = u.id) <= ${ts(now)} - ${days(P.inactiveDays)}
        and coalesce(greatest(
          (select max(p.updated_at) from watch_progress p where p.user_id = u.id),
          (select max(w.last_heartbeat_at) from watch_sessions w where w.user_id = u.id)
        ), '-infinity'::timestamptz) <= ${ts(now)} - ${days(P.inactiveDays)}
        and not exists (select 1 from email_enrollments e where e.user_id = u.id and e.sequence = 'member_onboarding' and e.status = 'active')`;
    case "winback":
      return sql`select u.id from "user" u where not ${MEMBER(now)}
        and (select max(s.current_period_end) from subscriptions s where s.user_id = u.id)
          between ${ts(now)} - ${days(P.winbackWindowDays)} and ${ts(now)} - ${days(P.winbackDelayDays)}`;
  }
}

/** Enroll everyone who now qualifies. Re-engagement can repeat after its cooldown; the others happen once. */
export async function enrollDue(db: Database, now: Date = new Date()): Promise<Record<SequenceId, number>> {
  const result = {} as Record<SequenceId, number>;
  for (const sequence of Object.keys(SEQUENCES) as SequenceId[]) {
    const repeat =
      sequence === "reengagement"
        ? sql`do update set status = 'active', step = 0, next_at = ${ts(now)}, attempts = 0, enrolled_at = ${ts(now)},
            finished_at = null, exit_reason = null, updated_at = ${ts(now)}
            where email_enrollments.status <> 'active' and email_enrollments.enrolled_at <= ${ts(now)} - ${days(P.reengageCooldownDays)}`
        : sql`do nothing`;
    const rows = await db.execute(sql`
      insert into email_enrollments (user_id, sequence, next_at, enrolled_at, updated_at)
      select c.id, ${sequence}, ${ts(now)}, ${ts(now)}, ${ts(now)} from (${candidates(sequence, now)}) c
      on conflict (user_id, sequence) ${repeat}
      returning id
    `);
    result[sequence] = rows.length;
  }
  return result;
}

type Claimed = { id: string; userId: string; sequence: string; step: number; attempts: number; enrolledAt: Date };

async function claimDue(db: Database, now: Date, limit: number): Promise<Claimed[]> {
  const rows = await db.execute<{ id: string; user_id: string; sequence: string; step: number; attempts: number; enrolled_at: string }>(sql`
    update email_enrollments set next_at = ${ts(now)} + make_interval(mins => ${sql.raw(String(P.leaseMinutes))}), updated_at = ${ts(now)}
    where id in (
      select id from email_enrollments where status = 'active' and next_at <= ${ts(now)}
      order by next_at limit ${limit} for update skip locked
    )
    returning id, user_id, sequence, step, attempts, enrolled_at
  `);
  return rows.map((r) => ({ id: r.id, userId: r.user_id, sequence: r.sequence, step: Number(r.step), attempts: Number(r.attempts), enrolledAt: new Date(r.enrolled_at) }));
}

async function finish(db: Database, id: string, status: "completed" | "exited", now: Date, exitReason: string | null = null) {
  await db.update(emailEnrollments).set({ status, exitReason, finishedAt: now, nextAt: null, updatedAt: now }).where(eq(emailEnrollments.id, id));
}

/** Move to the next step (or finish). Steps are timed from enrollment, never sooner than now. */
async function advance(db: Database, row: Claimed, now: Date) {
  const steps = SEQUENCES[row.sequence as SequenceId].steps;
  const next = row.step + 1;
  if (next >= steps.length) return finish(db, row.id, "completed", now);
  const due = new Date(Math.max(now.getTime(), row.enrolledAt.getTime() + steps[next]!.delayHours * 3_600_000));
  await db.update(emailEnrollments).set({ step: next, nextAt: due, attempts: 0, updatedAt: now }).where(eq(emailEnrollments.id, row.id));
}

async function recordSend(
  db: Database,
  values: { userId: string; key: string; category: EmailCategory; sequence?: string; step?: string; subject: string; status: "sent" | "failed" | "skipped"; error?: string | null },
  now: Date,
) {
  await db
    .insert(emailSends)
    .values({ ...values, createdAt: now })
    .onConflictDoUpdate({ target: emailSends.key, set: { status: values.status, error: values.error ?? null, subject: values.subject, createdAt: now } });
}

export type RunResult = { enrolled: Record<SequenceId, number>; sent: number; skipped: number; failed: number; exited: number; completed: number };

export type RunOptions = { appUrl: string; postalAddress?: string | null; now?: Date; batchSize?: number };

/** Enroll, then send what's due. */
export async function runEmailSequences(db: Database, mailer: Mailer, options: RunOptions): Promise<RunResult> {
  const now = options.now ?? new Date();
  const enrolled = await enrollDue(db, now);
  const result: RunResult = { enrolled, sent: 0, skipped: 0, failed: 0, exited: 0, completed: 0 };
  const due = await claimDue(db, now, options.batchSize ?? P.batchSize);
  let shared: SharedContext | undefined;

  for (const row of due) {
    const sequence = SEQUENCES[row.sequence as SequenceId];
    if (!sequence) {
      await finish(db, row.id, "exited", now, "unknown_sequence");
      result.exited++;
      continue;
    }
    const step = sequence.steps[row.step];
    if (!step) {
      await finish(db, row.id, "completed", now);
      result.completed++;
      continue;
    }
    shared ??= await loadSharedContext(db);
    const ctx = await loadEmailContext(db, row.userId, shared, now);
    const reason = !ctx ? "account_deleted" : sequence.exitReason(ctx, row.enrolledAt) ?? (!(await getPreferences(db, row.userId))[sequence.category] ? "unsubscribed" : null);
    if (reason || !ctx) {
      await finish(db, row.id, "exited", now, reason);
      result.exited++;
      continue;
    }

    const key = `seq:${row.id}:${row.enrolledAt.getTime()}:${step.id}`;
    const base = { userId: row.userId, key, category: sequence.category, sequence: sequence.id, step: step.id };
    const content = step.render(ctx);
    const [already] = await db.select({ status: emailSends.status }).from(emailSends).where(eq(emailSends.key, key));
    if (!content || already?.status === "sent") {
      if (!content) {
        await recordSend(db, { ...base, subject: "(nothing to send)", status: "skipped" }, now);
        result.skipped++;
      }
    } else {
      try {
        await mailer.send(
          renderEmail(content, {
            appUrl: options.appUrl,
            to: ctx.email,
            category: sequence.category,
            token: emailToken(row.userId),
            campaign: `${sequence.id}-${step.id}`,
            postalAddress: options.postalAddress,
            idempotencyKey: key,
          }),
        );
        await recordSend(db, { ...base, subject: content.subject, status: "sent" }, now);
        result.sent++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const attempts = row.attempts + 1;
        await recordSend(db, { ...base, subject: content.subject, status: "failed", error: message }, now);
        result.failed++;
        if (attempts < P.maxAttempts) {
          // Keep the lease as the retry delay.
          await db.update(emailEnrollments).set({ attempts, updatedAt: now }).where(eq(emailEnrollments.id, row.id));
          continue;
        }
      }
    }
    await advance(db, row, now);
    if (row.step + 1 >= sequence.steps.length) result.completed++;
  }
  return result;
}
