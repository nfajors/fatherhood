/**
 * Admin analytics: membership, revenue, sign-ups, viewing, learning and community
 * activity over a date range. Read-only; every figure comes from our own tables.
 *
 * Days are UTC calendar days. A range covers the `days` most recent days up to
 * and including today; "previous" is the same number of days just before it.
 */
import { and, desc, eq, gte, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import {
  certificates,
  coachMessages,
  comments,
  contentReports,
  courseModules,
  courses,
  creatorApplications,
  lessons,
  quizAttempts,
  ratings,
  revenueLedger,
  subscriptions,
  user,
  videos,
  watchSessions,
} from "@/lib/db/schema";
import { PLANS } from "@/lib/config";
import { REVENUE_POLICY } from "@/lib/revenue/policy";

export const RANGES = [7, 30, 90] as const;
export type RangeDays = (typeof RANGES)[number];

export type Range = { days: number; start: Date; end: Date; previousStart: Date };

const DAY_MS = 24 * 3_600_000;

/** The last `days` UTC days through today, ending at `now`. */
export function rangeEndingAt(now: Date, days: number): Range {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const start = new Date(today - (days - 1) * DAY_MS);
  return { days, start, end: now, previousStart: new Date(start.getTime() - days * DAY_MS) };
}

export function parseRange(value: string | undefined): RangeDays {
  const n = Number(value);
  return (RANGES as readonly number[]).includes(n) ? (n as RangeDays) : 30;
}

/** Every UTC day of the range as YYYY-MM-DD. */
export function rangeDays(range: Range): string[] {
  return Array.from({ length: range.days }, (_, i) => new Date(range.start.getTime() + i * DAY_MS).toISOString().slice(0, 10));
}

const iso = (d: Date) => sql`${d.toISOString()}::timestamptz`;
const dayOf = (column: unknown) => sql<string>`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD')`;

function fillDays(range: Range, rows: { day: string; value: number }[]) {
  const byDay = new Map(rows.map((r) => [r.day, r.value]));
  return rangeDays(range).map((day) => ({ day, value: byDay.get(day) ?? 0 }));
}

/** Current and previous-period values of one measure. */
export type Compared = { current: number; previous: number };

// ---------------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------------

/** Statuses that grant access now (lib/entitlements.ts). */
const ACCESS = ["active", "trialing", "past_due"] as const;

/**
 * When a membership stopped granting access: its period end while it still grants
 * access, otherwise the earlier of its period end and when it last changed (the
 * cancellation). Estimates history from current rows, which is all we keep.
 */
const accessEnd = sql`case when ${subscriptions.status} in ('active', 'trialing', 'past_due') then ${subscriptions.currentPeriodEnd}
  else least(${subscriptions.currentPeriodEnd}, ${subscriptions.updatedAt}) end`;

async function membersAt(db: Database, at: Date): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(distinct ${subscriptions.userId})::int` })
    .from(subscriptions)
    .where(and(sql`${subscriptions.status} not in ('incomplete', 'incomplete_expired')`, sql`${subscriptions.createdAt} <= ${iso(at)}`, sql`${accessEnd} > ${iso(at)}`));
  return row?.n ?? 0;
}

export async function membership(db: Database, range: Range) {
  const now = range.end;
  const current = await db
    .select({ plan: subscriptions.plan, members: sql<number>`count(distinct ${subscriptions.userId})::int` })
    .from(subscriptions)
    .where(and(inArray(subscriptions.status, [...ACCESS]), sql`${subscriptions.currentPeriodEnd} > ${iso(now)}`))
    .groupBy(subscriptions.plan);
  const [active] = await db
    .select({ n: sql<number>`count(distinct ${subscriptions.userId})::int` })
    .from(subscriptions)
    .where(and(inArray(subscriptions.status, [...ACCESS]), sql`${subscriptions.currentPeriodEnd} > ${iso(now)}`));

  // Monthly recurring revenue from auto-renewing plans; members set to cancel still count until they lapse.
  const [mrr] = await db
    .select({
      cents: sql<number>`coalesce(sum(case ${subscriptions.plan} when 'monthly' then ${PLANS.monthly.amountCents} when 'annual' then ${PLANS.annual.amountCents} / 12.0 else 0 end), 0)::int`,
      renewing: sql<number>`count(*) filter (where not ${subscriptions.cancelAtPeriodEnd} and ${subscriptions.plan} <> 'gift')::int`,
      cancelling: sql<number>`count(*) filter (where ${subscriptions.cancelAtPeriodEnd} and ${subscriptions.plan} <> 'gift')::int`,
    })
    .from(subscriptions)
    .where(and(inArray(subscriptions.status, ["active", "past_due"]), sql`${subscriptions.currentPeriodEnd} > ${iso(now)}`));

  const startedIn = (from: Date, to: Date) =>
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(subscriptions)
      .where(and(sql`${subscriptions.status} not in ('incomplete', 'incomplete_expired')`, gte(subscriptions.createdAt, from), lt(subscriptions.createdAt, to)));
  const endedIn = (from: Date, to: Date) =>
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(subscriptions)
      .where(
        and(
          sql`${subscriptions.status} not in ('incomplete', 'incomplete_expired')`,
          sql`${accessEnd} >= ${iso(from)}`,
          sql`${accessEnd} < ${iso(to)}`,
        ),
      );
  const [[started], [startedBefore], [ended], [endedBefore], atStart] = await Promise.all([
    startedIn(range.start, now),
    startedIn(range.previousStart, range.start),
    endedIn(range.start, now),
    endedIn(range.previousStart, range.start),
    membersAt(db, range.start),
  ]);

  // Members at the end of each day (now, for today).
  const daily = await db.execute<{ day: string; value: number }>(sql`
    select to_char(d, 'YYYY-MM-DD') as day, count(distinct s.user_id)::int as value
    from generate_series(${range.start.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz, interval '1 day') as d
    left join subscriptions s
      on s.status not in ('incomplete', 'incomplete_expired')
      and s.created_at <= least(d + interval '1 day', ${now.toISOString()}::timestamptz)
      and (case when s.status in ('active', 'trialing', 'past_due') then s.current_period_end
           else least(s.current_period_end, s.updated_at) end) > least(d + interval '1 day', ${now.toISOString()}::timestamptz)
    group by d order by d`);

  const byPlan = Object.fromEntries(current.map((r) => [r.plan, r.members])) as Partial<Record<"monthly" | "annual" | "gift", number>>;
  return {
    active: active?.n ?? 0,
    activeAtStart: atStart,
    plans: { monthly: byPlan.monthly ?? 0, annual: byPlan.annual ?? 0, gift: byPlan.gift ?? 0 },
    mrrCents: mrr?.cents ?? 0,
    renewing: mrr?.renewing ?? 0,
    cancelling: mrr?.cancelling ?? 0,
    started: { current: started?.n ?? 0, previous: startedBefore?.n ?? 0 } satisfies Compared,
    ended: { current: ended?.n ?? 0, previous: endedBefore?.n ?? 0 } satisfies Compared,
    /** Memberships that ended in the range, per member at its start. Null with no members to lose. */
    churnRate: atStart > 0 ? (ended?.n ?? 0) / atStart : null,
    daily: fillDays(range, [...daily].map((r) => ({ day: r.day, value: Number(r.value) }))),
  };
}

// ---------------------------------------------------------------------------
// Revenue
// ---------------------------------------------------------------------------

/** Paid revenue (subscription invoices and gifts) in the range, and by month for the last 12 months. */
export async function revenue(db: Database, range: Range) {
  const total = (from: Date, to: Date) =>
    db
      .select({
        cents: sql<number>`coalesce(sum(${revenueLedger.amountCents}), 0)::int`,
        gifts: sql<number>`coalesce(sum(${revenueLedger.amountCents}) filter (where ${revenueLedger.kind} = 'gift'), 0)::int`,
      })
      .from(revenueLedger)
      .where(and(gte(revenueLedger.occurredAt, from), lt(revenueLedger.occurredAt, to)));
  const now = range.end;
  const firstMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
  const [[current], [previous], monthlyRows] = await Promise.all([
    total(range.start, now),
    total(range.previousStart, range.start),
    db
      .select({
        month: sql<string>`to_char(${revenueLedger.occurredAt} at time zone 'UTC', 'YYYY-MM')`,
        subscriptions: sql<number>`coalesce(sum(${revenueLedger.amountCents}) filter (where ${revenueLedger.kind} = 'subscription_invoice'), 0)::int`,
        gifts: sql<number>`coalesce(sum(${revenueLedger.amountCents}) filter (where ${revenueLedger.kind} = 'gift'), 0)::int`,
      })
      .from(revenueLedger)
      .where(gte(revenueLedger.occurredAt, firstMonth))
      .groupBy(sql`1`),
  ]);
  const byMonth = new Map(monthlyRows.map((r) => [r.month, r]));
  const monthly = Array.from({ length: 12 }, (_, i) => {
    const month = new Date(Date.UTC(firstMonth.getUTCFullYear(), firstMonth.getUTCMonth() + i, 1)).toISOString().slice(0, 7);
    const row = byMonth.get(month);
    const subscriptionsCents = row?.subscriptions ?? 0;
    const giftsCents = row?.gifts ?? 0;
    return { month, subscriptionsCents, giftsCents, totalCents: subscriptionsCents + giftsCents };
  });
  const cents = current?.cents ?? 0;
  return {
    totalCents: { current: cents, previous: previous?.cents ?? 0 } satisfies Compared,
    giftCents: current?.gifts ?? 0,
    /** What this range adds to the creator pool. */
    creatorPoolCents: Math.floor((cents * REVENUE_POLICY.poolShareBps) / 10_000),
    monthly,
  };
}

// ---------------------------------------------------------------------------
// Sign-ups
// ---------------------------------------------------------------------------

export async function signups(db: Database, range: Range) {
  const count = (from: Date, to: Date) =>
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(user)
      .where(and(gte(user.createdAt, from), lt(user.createdAt, to)));
  const [[current], [previous], daily, [converted]] = await Promise.all([
    count(range.start, range.end),
    count(range.previousStart, range.start),
    db
      .select({ day: dayOf(user.createdAt), value: sql<number>`count(*)::int` })
      .from(user)
      .where(gte(user.createdAt, range.start))
      .groupBy(sql`1`),
    // Of the people who signed up in the range, how many have become members since.
    db
      .select({ n: sql<number>`count(distinct ${user.id})::int` })
      .from(user)
      .innerJoin(subscriptions, eq(subscriptions.userId, user.id))
      .where(and(gte(user.createdAt, range.start), sql`${subscriptions.status} not in ('incomplete', 'incomplete_expired')`)),
  ]);
  const n = current?.n ?? 0;
  return {
    count: { current: n, previous: previous?.n ?? 0 } satisfies Compared,
    becameMembers: converted?.n ?? 0,
    conversionRate: n > 0 ? (converted?.n ?? 0) / n : null,
    daily: fillDays(range, daily),
  };
}

// ---------------------------------------------------------------------------
// Viewing
// ---------------------------------------------------------------------------

const COUNTED = REVENUE_POLICY.minWatchSecondsPerView;

export async function viewing(db: Database, range: Range) {
  const totals = (from: Date, to: Date) =>
    db
      .select({
        views: sql<number>`(count(*) filter (where ${watchSessions.secondsWatched} >= ${COUNTED}))::int`,
        academyViews: sql<number>`(count(*) filter (where ${watchSessions.secondsWatched} >= ${COUNTED} and ${videos.type} = 'professional'))::int`,
        seconds: sql<number>`coalesce(sum(${watchSessions.secondsWatched}), 0)::bigint`,
        viewers: sql<number>`count(distinct ${watchSessions.userId})::int`,
        anonymousViews: sql<number>`(count(*) filter (where ${watchSessions.secondsWatched} >= ${COUNTED} and ${watchSessions.userId} is null))::int`,
      })
      .from(watchSessions)
      .innerJoin(videos, eq(videos.id, watchSessions.videoId))
      .where(and(gte(watchSessions.startedAt, from), lt(watchSessions.startedAt, to)));
  const [[current], [previous], daily] = await Promise.all([
    totals(range.start, range.end),
    totals(range.previousStart, range.start),
    db
      .select({ day: dayOf(watchSessions.startedAt), value: sql<number>`count(*)::int` })
      .from(watchSessions)
      .where(and(gte(watchSessions.startedAt, range.start), gte(watchSessions.secondsWatched, COUNTED)))
      .groupBy(sql`1`),
  ]);
  const views = current?.views ?? 0;
  const academy = current?.academyViews ?? 0;
  return {
    views: { current: views, previous: previous?.views ?? 0 } satisfies Compared,
    watchSeconds: { current: Number(current?.seconds ?? 0), previous: Number(previous?.seconds ?? 0) } satisfies Compared,
    academyViews: academy,
    communityViews: views - academy,
    /** Signed-in people who watched anything; signed-out Community views are counted separately. */
    signedInViewers: current?.viewers ?? 0,
    anonymousViews: current?.anonymousViews ?? 0,
    daily: fillDays(range, daily),
  };
}

/** The most-watched videos in the range. */
export async function topVideos(db: Database, range: Range, limit = 10) {
  const views = sql<number>`(count(*) filter (where ${watchSessions.secondsWatched} >= ${COUNTED}))::int`;
  const watchSeconds = sql<number>`coalesce(sum(${watchSessions.secondsWatched}), 0)::int`;
  return db
    .select({
      id: videos.id,
      title: videos.title,
      type: videos.type,
      creator: user.name,
      views,
      watchSeconds,
      ratingAverage: videos.ratingAverage,
      ratingCount: videos.ratingCount,
    })
    .from(watchSessions)
    .innerJoin(videos, eq(videos.id, watchSessions.videoId))
    .innerJoin(user, eq(user.id, videos.creatorId))
    .where(and(gte(watchSessions.startedAt, range.start), lt(watchSessions.startedAt, range.end)))
    .groupBy(videos.id, user.name)
    .having(sql`count(*) filter (where ${watchSessions.secondsWatched} >= ${COUNTED}) > 0`)
    .orderBy(desc(views), desc(watchSeconds), videos.title)
    .limit(limit);
}

// ---------------------------------------------------------------------------
// Learning
// ---------------------------------------------------------------------------

/**
 * Published courses with the learners who watched any of their lessons in the range,
 * certificates issued in the range, and all-time certificates.
 */
export async function courseActivity(db: Database, range: Range) {
  const [learners, certs] = await Promise.all([
    db
      .select({ courseId: courseModules.courseId, learners: sql<number>`count(distinct ${watchSessions.userId})::int` })
      .from(watchSessions)
      .innerJoin(lessons, eq(lessons.videoId, watchSessions.videoId))
      .innerJoin(courseModules, eq(courseModules.id, lessons.moduleId))
      .where(and(gte(watchSessions.startedAt, range.start), lt(watchSessions.startedAt, range.end), sql`${watchSessions.userId} is not null`))
      .groupBy(courseModules.courseId),
    db
      .select({
        courseId: certificates.courseId,
        inRange: sql<number>`(count(*) filter (where ${certificates.issuedAt} >= ${iso(range.start)}))::int`,
        allTime: sql<number>`count(*)::int`,
      })
      .from(certificates)
      .where(isNull(certificates.revokedAt))
      .groupBy(certificates.courseId),
  ]);
  const published = await db.select({ id: courses.id, title: courses.title, slug: courses.slug }).from(courses).where(eq(courses.published, true));
  const learnersBy = new Map(learners.map((l) => [l.courseId, l.learners]));
  const certsBy = new Map(certs.map((c) => [c.courseId, c]));
  return published
    .map((c) => ({
      ...c,
      learners: learnersBy.get(c.id) ?? 0,
      certificates: certsBy.get(c.id)?.inRange ?? 0,
      certificatesAllTime: certsBy.get(c.id)?.allTime ?? 0,
    }))
    .sort((a, b) => b.learners - a.learners || b.certificates - a.certificates || a.title.localeCompare(b.title));
}

export async function learning(db: Database, range: Range) {
  const [[quiz], [certs]] = await Promise.all([
    db
      .select({ attempts: sql<number>`count(*)::int`, passed: sql<number>`(count(*) filter (where ${quizAttempts.passed}))::int` })
      .from(quizAttempts)
      .where(and(gte(quizAttempts.createdAt, range.start), lt(quizAttempts.createdAt, range.end))),
    db
      .select({
        current: sql<number>`(count(*) filter (where ${certificates.issuedAt} >= ${iso(range.start)}))::int`,
        previous: sql<number>`(count(*) filter (where ${certificates.issuedAt} >= ${iso(range.previousStart)} and ${certificates.issuedAt} < ${iso(range.start)}))::int`,
      })
      .from(certificates)
      .where(isNull(certificates.revokedAt)),
  ]);
  const attempts = quiz?.attempts ?? 0;
  return {
    quizAttempts: attempts,
    quizPassRate: attempts > 0 ? (quiz?.passed ?? 0) / attempts : null,
    certificates: { current: certs?.current ?? 0, previous: certs?.previous ?? 0 } satisfies Compared,
  };
}

/** Coach use in the range: counts only, never content (conversations are private). */
export async function coachUsage(db: Database, range: Range) {
  const [row] = await db
    .select({
      members: sql<number>`count(distinct ${coachMessages.userId}) filter (where ${coachMessages.role} = 'user')::int`,
      messages: sql<number>`(count(*) filter (where ${coachMessages.role} = 'user'))::int`,
      conversations: sql<number>`count(distinct ${coachMessages.conversationId})::int`,
      outputTokens: sql<number>`coalesce(sum(${coachMessages.outputTokens}), 0)::bigint`,
    })
    .from(coachMessages)
    .where(and(gte(coachMessages.createdAt, range.start), lt(coachMessages.createdAt, range.end)));
  return { members: row?.members ?? 0, messages: row?.messages ?? 0, conversations: row?.conversations ?? 0, outputTokens: Number(row?.outputTokens ?? 0) };
}

// ---------------------------------------------------------------------------
// Community and creators
// ---------------------------------------------------------------------------

export async function community(db: Database, range: Range) {
  const inRange = (column: Parameters<typeof gte>[0]) => and(gte(column, range.start), lt(column, range.end));
  const [[c], [r], [published], [queue], [reports], [fellows], [applications]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(comments).where(and(inRange(comments.createdAt), ne(comments.status, "removed"))),
    db.select({ n: sql<number>`count(*)::int`, reviews: sql<number>`(count(*) filter (where ${ratings.review} is not null))::int` }).from(ratings).where(inRange(ratings.createdAt)),
    db
      .select({ community: sql<number>`(count(*) filter (where ${videos.type} = 'community'))::int`, academy: sql<number>`(count(*) filter (where ${videos.type} = 'professional'))::int` })
      .from(videos)
      .where(and(eq(videos.status, "approved"), inRange(videos.publishedAt))),
    db.select({ n: sql<number>`count(*)::int` }).from(videos).where(eq(videos.status, "pending_review")),
    db.select({ n: sql<number>`count(*)::int` }).from(contentReports).where(eq(contentReports.status, "open")),
    db.select({ n: sql<number>`count(*)::int` }).from(user).where(eq(user.role, "creator")),
    db.select({ n: sql<number>`count(*)::int` }).from(creatorApplications).where(eq(creatorApplications.status, "pending")),
  ]);
  return {
    comments: c?.n ?? 0,
    ratings: r?.n ?? 0,
    writtenReviews: r?.reviews ?? 0,
    communityVideosPublished: published?.community ?? 0,
    academyVideosPublished: published?.academy ?? 0,
    awaitingReview: queue?.n ?? 0,
    openReports: reports?.n ?? 0,
    fellows: fellows?.n ?? 0,
    pendingApplications: applications?.n ?? 0,
  };
}

/** Everything on the analytics page, for one range. */
export async function analyticsOverview(db: Database, range: Range) {
  const [members, money, joined, watched, top, courseRows, learned, social, coach] = await Promise.all([
    membership(db, range),
    revenue(db, range),
    signups(db, range),
    viewing(db, range),
    topVideos(db, range),
    courseActivity(db, range),
    learning(db, range),
    community(db, range),
    coachUsage(db, range),
  ]);
  return { range, members, money, joined, watched, top, courses: courseRows, learned, social, coach };
}
