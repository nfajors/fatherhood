/**
 * What a creator sees in the Studio: their videos with review status and
 * audience numbers, totals, and earnings (this month's estimate, settled
 * shares and payouts). Every query is scoped to one creator.
 */
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { creatorPayouts, poolCalculations, poolShares, videoReviews, videos, watchSessions, type VideoReviewAction } from "@/lib/db/schema";
import { engagementScoreMilli, isEligible, monthPeriod, quarterToDate, type VideoViews } from "@/lib/revenue/pool";
import { REVENUE_POLICY as P } from "@/lib/revenue/policy";
import { estimatePeriod } from "@/lib/revenue/settlement";

/** Reviewer decisions a creator is told about (not the AI screen's internals). */
const DECISIONS: VideoReviewAction[] = ["approve", "auto_approve", "reject", "request_changes", "unpublish", "restore"];

const watchSecondsOf = sql<number>`(select coalesce(sum(s.seconds_watched), 0)::int from watch_sessions s where s.video_id = "videos"."id")`;

export type StudioVideo = Awaited<ReturnType<typeof studioVideos>>[number];

/** The creator's videos, newest first, with numbers and the latest reviewer decision. */
export async function studioVideos(db: Database, creatorId: string) {
  const rows = await db
    .select({
      id: videos.id,
      type: videos.type,
      status: videos.status,
      title: videos.title,
      durationSeconds: videos.durationSeconds,
      thumbnailUrl: videos.thumbnailUrl,
      requireSignedUrls: videos.requireSignedUrls,
      views: videos.viewCount,
      watchSeconds: watchSecondsOf,
      ratingAverage: videos.ratingAverage,
      ratingCount: videos.ratingCount,
      createdAt: videos.createdAt,
      publishedAt: videos.publishedAt,
    })
    .from(videos)
    .where(eq(videos.creatorId, creatorId))
    .orderBy(desc(videos.createdAt));
  const decisions = await latestDecisions(db, rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, lastDecision: decisions.get(r.id) ?? null }));
}

async function latestDecisions(db: Database, videoIds: string[]) {
  if (videoIds.length === 0) return new Map<string, { action: VideoReviewAction; notes: string | null; at: Date }>();
  const rows = await db
    .selectDistinctOn([videoReviews.videoId], {
      videoId: videoReviews.videoId,
      action: videoReviews.action,
      notes: videoReviews.notes,
      at: videoReviews.createdAt,
    })
    .from(videoReviews)
    .where(and(inArray(videoReviews.videoId, videoIds), inArray(videoReviews.action, DECISIONS)))
    .orderBy(videoReviews.videoId, desc(videoReviews.createdAt));
  return new Map(rows.map(({ videoId, ...d }) => [videoId, d]));
}

/** Headline numbers: counts by state, views and watch time (all time and last 30 days), rating. */
export async function studioSummary(db: Database, creatorId: string, now: Date = new Date()) {
  const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const [counts] = await db
    .select({
      published: sql<number>`count(*) filter (where ${videos.status} = 'approved')::int`,
      inReview: sql<number>`count(*) filter (where ${videos.status} in ('uploading', 'processing', 'pending_review'))::int`,
      needsAttention: sql<number>`count(*) filter (where ${videos.status} in ('changes_requested', 'failed'))::int`,
      views: sql<number>`coalesce(sum(${videos.viewCount}), 0)::int`,
      ratingCount: sql<number>`coalesce(sum(${videos.ratingCount}), 0)::int`,
      ratingAverage: sql<string | null>`(sum(${videos.ratingAverage} * ${videos.ratingCount}) / nullif(sum(${videos.ratingCount}), 0))::numeric(3,2)`,
    })
    .from(videos)
    .where(eq(videos.creatorId, creatorId));
  const [watch] = await db
    .select({
      watchSeconds: sql<number>`coalesce(sum(${watchSessions.secondsWatched}), 0)::int`,
      recentWatchSeconds: sql<number>`coalesce(sum(${watchSessions.secondsWatched}) filter (where ${watchSessions.startedAt} >= ${since.toISOString()}::timestamptz), 0)::int`,
      recentViews: sql<number>`(count(*) filter (where ${watchSessions.startedAt} >= ${since.toISOString()}::timestamptz and ${watchSessions.secondsWatched} >= ${P.minWatchSecondsPerView}))::int`,
    })
    .from(watchSessions)
    .innerJoin(videos, eq(watchSessions.videoId, videos.id))
    .where(eq(videos.creatorId, creatorId));
  return {
    published: counts?.published ?? 0,
    inReview: counts?.inReview ?? 0,
    needsAttention: counts?.needsAttention ?? 0,
    views: counts?.views ?? 0,
    ratingCount: counts?.ratingCount ?? 0,
    ratingAverage: counts?.ratingAverage ? Number(counts.ratingAverage) : null,
    watchSeconds: watch?.watchSeconds ?? 0,
    recentWatchSeconds: watch?.recentWatchSeconds ?? 0,
    recentViews: watch?.recentViews ?? 0,
  };
}

/** One of the creator's videos with its decision history (AI screening left out). */
export async function studioVideo(db: Database, creatorId: string, videoId: string) {
  const [video] = await db
    .select()
    .from(videos)
    .where(and(eq(videos.id, videoId), eq(videos.creatorId, creatorId)));
  if (!video) return null;
  const [history, [watch]] = await Promise.all([
    db
      .select({ action: videoReviews.action, toStatus: videoReviews.toStatus, notes: videoReviews.notes, at: videoReviews.createdAt })
      .from(videoReviews)
      .where(and(eq(videoReviews.videoId, videoId), sql`${videoReviews.action} <> 'ai_screen'`))
      .orderBy(desc(videoReviews.createdAt)),
    db
      .select({ watchSeconds: sql<number>`coalesce(sum(${watchSessions.secondsWatched}), 0)::int` })
      .from(watchSessions)
      .where(eq(watchSessions.videoId, videoId)),
  ]);
  return { video, history, watchSeconds: watch?.watchSeconds ?? 0 };
}

// ---------------------------------------------------------------------------
// Earnings
// ---------------------------------------------------------------------------

async function titles(db: Database, videoIds: string[]): Promise<Map<string, string>> {
  if (videoIds.length === 0) return new Map();
  const rows = await db.select({ id: videos.id, title: videos.title }).from(videos).where(inArray(videos.id, videoIds));
  return new Map(rows.map((r) => [r.id, r.title]));
}

/**
 * This month so far, computed exactly as settlement will (the pool depends on
 * the month's revenue and everyone's engagement, so it moves until month end).
 * Only the creator's own figures are returned, never the pool or other creators.
 */
export async function earningsEstimate(db: Database, creatorId: string, now: Date = new Date()) {
  const month = monthPeriod(now.getUTCFullYear(), now.getUTCMonth() + 1);
  const period = { start: month.start, end: now };
  const { inputs, shares } = await estimatePeriod(db, period);
  const mine = inputs.find((c) => c.creatorId === creatorId) ?? { creatorId, videosPostedInQuarter: 0, videos: [] as VideoViews[] };
  const share = shares.find((s) => s.creatorId === creatorId);
  const counted = mine.videos.filter((v) => v.qualifyingViews >= P.minViewsPerVideo);
  const countedViews = counted.reduce((sum, v) => sum + v.qualifyingViews, 0);
  const names = await titles(db, mine.videos.map((v) => v.videoId));

  return {
    month,
    quarterStart: quarterToDate(period).start,
    eligible: isEligible(mine),
    checks: {
      postedThisQuarter: mine.videosPostedInQuarter >= P.minVideosPerQuarter,
      videoReachedViewThreshold: counted.length > 0,
    },
    videosPostedInQuarter: mine.videosPostedInQuarter,
    qualifyingViews: countedViews,
    /** Engagement score in points (0-100). */
    score: engagementScoreMilli(mine.videosPostedInQuarter, countedViews) / 1000,
    estimatedCents: share?.amountCents ?? 0,
    videos: mine.videos
      .map((v) => ({ ...v, title: names.get(v.videoId) ?? "Removed video", counts: v.qualifyingViews >= P.minViewsPerVideo }))
      .sort((a, b) => b.qualifyingViews - a.qualifyingViews),
  };
}

/** Settled monthly shares, payouts and balances. */
export async function earningsHistory(db: Database, creatorId: string) {
  const [shares, payouts] = await Promise.all([
    db
      .select({
        id: poolShares.id,
        periodStart: poolCalculations.periodStart,
        amountCents: poolShares.amountCents,
        qualifyingViews: poolShares.qualifyingViews,
        videosPostedInQuarter: poolShares.videosPostedInQuarter,
        engagementScoreMilli: poolShares.engagementScoreMilli,
        breakdown: poolShares.breakdown,
        payoutId: poolShares.payoutId,
        payoutStatus: creatorPayouts.status,
      })
      .from(poolShares)
      .innerJoin(poolCalculations, eq(poolShares.calculationId, poolCalculations.id))
      .leftJoin(creatorPayouts, eq(poolShares.payoutId, creatorPayouts.id))
      .where(eq(poolShares.creatorId, creatorId))
      .orderBy(desc(poolCalculations.periodStart)),
    db
      .select({
        id: creatorPayouts.id,
        amountCents: creatorPayouts.amountCents,
        status: creatorPayouts.status,
        periodEnd: creatorPayouts.periodEnd,
        paidAt: creatorPayouts.paidAt,
        createdAt: creatorPayouts.createdAt,
      })
      .from(creatorPayouts)
      .where(eq(creatorPayouts.creatorId, creatorId))
      .orderBy(desc(creatorPayouts.createdAt)),
  ]);

  const names = await titles(db, [...new Set(shares.flatMap((s) => (s.breakdown as VideoViews[]).map((v) => v.videoId)))]);
  const sum = (rows: { amountCents: number }[]) => rows.reduce((total, r) => total + r.amountCents, 0);
  return {
    balances: {
      /** Settled but not yet in a payout: carried forward until it reaches the minimum. */
      unpaidCents: sum(shares.filter((s) => !s.payoutId)),
      inPayoutCents: sum(payouts.filter((p) => p.status === "pending" || p.status === "processing")),
      paidCents: sum(payouts.filter((p) => p.status === "paid")),
      minPayoutCents: P.minPayoutCents,
    },
    shares: shares.map((s) => ({
      ...s,
      score: s.engagementScoreMilli / 1000,
      breakdown: (s.breakdown as VideoViews[]).map((v) => ({ ...v, title: names.get(v.videoId) ?? "Removed video" })),
    })),
    payouts,
  };
}

/** Counted views (30s+) per day for the last `days` days, for the creator's videos. */
export async function dailyViews(db: Database, creatorId: string, days = 30, now: Date = new Date()) {
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1)));
  const rows = await db
    .select({ day: sql<string>`to_char(${watchSessions.startedAt} at time zone 'UTC', 'YYYY-MM-DD')`, views: sql<number>`count(*)::int` })
    .from(watchSessions)
    .innerJoin(videos, eq(watchSessions.videoId, videos.id))
    .where(and(eq(videos.creatorId, creatorId), gte(watchSessions.startedAt, since), gte(watchSessions.secondsWatched, P.minWatchSecondsPerView)))
    .groupBy(sql`1`);
  const byDay = new Map(rows.map((r) => [r.day, r.views]));
  return Array.from({ length: days }, (_, i) => {
    const day = new Date(since.getTime() + i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return { day, views: byDay.get(day) ?? 0 };
  });
}
