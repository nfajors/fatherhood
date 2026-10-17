/**
 * Creator revenue share policy. Mirrors Winning Careers' membership pool
 * (winning-backend-staging app/services/revenue/pool_calculator.py,
 * membership_pool_service.py "v2.0" and payout_service.py), adapted to
 * Fatherhood.School's videos and monthly settlement.
 */
export const REVENUE_POLICY = {
  algorithmVersion: "winning-v2.0",

  /** Share of subscription revenue that funds the creator pool, in basis points (25%). */
  poolShareBps: 2_500,

  /** Engagement score = 50% videos-posted score + 50% views score, each capped at 100. */
  weightVideosPosted: 0.5,
  weightViews: 0.5,
  /** Points per approved video posted in the quarter (20 videos = 100). */
  pointsPerVideo: 5,
  /** Views per point (1,000 views = 100). */
  viewsPerPoint: 10,
  maxComponentScore: 100,

  /** A creator must post at least this many approved videos in the calendar quarter. */
  minVideosPerQuarter: 1,
  /** A playback session counts as a view only after this much watching. */
  minWatchSecondsPerView: 30,
  /** A video needs this many counted views in the period to contribute. */
  minViewsPerVideo: 10,

  /** Balances below this carry forward to the next settlement. */
  minPayoutCents: 20_00,
} as const;
