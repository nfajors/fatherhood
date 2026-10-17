/**
 * Pure revenue-pool math. Settlement (settlement.ts) loads the inputs from the
 * database and persists the result; everything here is deterministic and
 * unit-tested.
 *
 * Scores are kept as integer milli-points so allocation is exact: a score of
 * 52.65 points is 52_650.
 */
import { REVENUE_POLICY as P } from "./policy";

export type Period = { start: Date; end: Date }; // end is exclusive

/** A calendar month in UTC; `month` is 1-12. */
export function monthPeriod(year: number, month: number): Period {
  return { start: new Date(Date.UTC(year, month - 1, 1)), end: new Date(Date.UTC(year, month, 1)) };
}

/**
 * The calendar quarter containing the period, up to the end of the period. Winning
 * checks the whole quarter; stopping at the period end keeps re-runs of a past
 * month from changing when creators post later in the quarter.
 */
export function quarterToDate(period: Period): Period {
  const s = period.start;
  const quarterStartMonth = Math.floor(s.getUTCMonth() / 3) * 3;
  return { start: new Date(Date.UTC(s.getUTCFullYear(), quarterStartMonth, 1)), end: period.end };
}

/** Pool funded from the period's subscription revenue (truncated to whole cents, as in Winning). */
export function poolAmountCents(subscriptionRevenueCents: number): number {
  return Math.floor((subscriptionRevenueCents * P.poolShareBps) / 10_000);
}

const MILLI = 1_000;

/**
 * Winning's engagement score in milli-points:
 * 0.5 x min(videos x 5, 100) + 0.5 x min(views / 10, 100).
 */
export function engagementScoreMilli(videosPostedInQuarter: number, qualifyingViews: number): number {
  const cap = P.maxComponentScore * MILLI;
  const videos = Math.min(videosPostedInQuarter * P.pointsPerVideo * MILLI, cap);
  const views = Math.min(Math.floor((qualifyingViews * MILLI) / P.viewsPerPoint), cap);
  return Math.round(videos * P.weightVideosPosted + views * P.weightViews);
}

export type VideoViews = { videoId: string; qualifyingViews: number };

export type CreatorInput = {
  creatorId: string;
  /** Approved videos published in the quarter to date. */
  videosPostedInQuarter: number;
  /** Per-video views in the period, counting only sessions of at least minWatchSecondsPerView. */
  videos: VideoViews[];
};

export type CreatorShare = {
  creatorId: string;
  videosPostedInQuarter: number;
  qualifyingViews: number;
  engagementScoreMilli: number;
  /** Share of the pool in basis points (informational; amounts are computed exactly). */
  shareBps: number;
  amountCents: number;
  /** Videos that met minViewsPerVideo, with their view counts. */
  breakdown: VideoViews[];
};

/** Videos that meet the per-video view threshold. */
function countedVideos(videos: VideoViews[]): VideoViews[] {
  return videos.filter((v) => v.qualifyingViews >= P.minViewsPerVideo);
}

/**
 * Eligible when the creator posted enough approved videos this quarter and at
 * least one video reached the per-video view threshold in the period.
 */
export function isEligible(creator: CreatorInput): boolean {
  return creator.videosPostedInQuarter >= P.minVideosPerQuarter && countedVideos(creator.videos).length > 0;
}

/**
 * Split the pool across eligible creators in proportion to engagement score,
 * rounding each share half-up and giving any rounding difference to the largest
 * share, exactly as Winning does, so shares always sum to the pool.
 */
export function allocatePool(poolCents: number, creators: CreatorInput[]): CreatorShare[] {
  const rows = creators.filter(isEligible).map((c) => {
    const breakdown = countedVideos(c.videos);
    const qualifyingViews = breakdown.reduce((sum, v) => sum + v.qualifyingViews, 0);
    return {
      creatorId: c.creatorId,
      videosPostedInQuarter: c.videosPostedInQuarter,
      qualifyingViews,
      engagementScoreMilli: engagementScoreMilli(c.videosPostedInQuarter, qualifyingViews),
      breakdown,
    };
  });
  if (rows.length === 0 || poolCents <= 0) {
    return rows.map((r) => ({ ...r, shareBps: 0, amountCents: 0 }));
  }

  // Eligibility guarantees at least one posted video, so every score is positive.
  const total = BigInt(rows.reduce((sum, r) => sum + r.engagementScoreMilli, 0));
  const pool = BigInt(poolCents);
  const shares: CreatorShare[] = rows.map((r) => {
    const score = BigInt(r.engagementScoreMilli);
    return {
      ...r,
      shareBps: Number((score * 10_000n * 2n + total) / (2n * total)),
      amountCents: Number((pool * score * 2n + total) / (2n * total)),
    };
  });

  const difference = poolCents - shares.reduce((sum, s) => sum + s.amountCents, 0);
  if (difference !== 0) {
    const largest = shares.reduce((a, b) => (b.amountCents > a.amountCents ? b : a));
    largest.amountCents += difference;
  }
  return shares;
}

/**
 * Which creators are paid this cycle: those whose unpaid balance reaches the
 * minimum payout. Everyone else carries their balance forward.
 */
export function payableBalances(unpaidCentsByCreator: Map<string, number>): Map<string, number> {
  const payable = new Map<string, number>();
  for (const [creatorId, cents] of unpaidCentsByCreator) {
    if (cents >= P.minPayoutCents) payable.set(creatorId, cents);
  }
  return payable;
}
