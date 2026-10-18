/**
 * Ratings and reviews (docs/development-plan.md 3.1): 1-5 stars and an optional
 * written review per viewer per video, helpful votes, and the aggregates shown
 * on cards. Aggregates are recomputed in the same transaction as every change.
 */
import { and, desc, eq, isNull, isNotNull, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { ratings, reviewHelpfulVotes, user, videos, watchProgress, watchSessions } from "@/lib/db/schema";
import { RATING_POLICY } from "./policy";

export { RATING_POLICY };

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export class RatingError extends Error {
  constructor(
    readonly reason: "not_found" | "own_video" | "not_watched" | "own_review",
    message: string,
  ) {
    super(message);
    this.name = "RatingError";
  }
}

/** Why this person can't rate this video, or null when they can. */
export async function ratingBlocker(
  db: Database | Transaction,
  userId: string,
  videoId: string,
): Promise<{ reason: RatingError["reason"]; message: string } | null> {
  const [video] = await db.select({ creatorId: videos.creatorId, status: videos.status }).from(videos).where(eq(videos.id, videoId));
  if (!video || video.status !== "approved") return { reason: "not_found", message: "Video not found." };
  if (video.creatorId === userId) return { reason: "own_video", message: "You can't rate your own video." };
  const [[session], [progress]] = await Promise.all([
    db
      .select({ seconds: sql<number>`coalesce(sum(${watchSessions.secondsWatched}), 0)::int` })
      .from(watchSessions)
      .where(and(eq(watchSessions.videoId, videoId), eq(watchSessions.userId, userId))),
    db
      .select({ completed: watchProgress.completed })
      .from(watchProgress)
      .where(and(eq(watchProgress.videoId, videoId), eq(watchProgress.userId, userId))),
  ]);
  if (!progress?.completed && (session?.seconds ?? 0) < RATING_POLICY.minWatchSeconds) {
    return { reason: "not_watched", message: "Watch a little of the video before rating it." };
  }
  return null;
}

/** Recompute a video's average and count from its ratings. */
async function refreshAggregates(tx: Transaction, videoId: string) {
  await tx
    .update(videos)
    .set({
      ratingAverage: sql`(select round(avg(${ratings.stars})::numeric, 2) from ${ratings} where ${ratings.videoId} = ${videoId})`,
      ratingCount: sql`(select count(*)::int from ${ratings} where ${ratings.videoId} = ${videoId})`,
    })
    .where(eq(videos.id, videoId));
}

/** Create or update the viewer's rating. A review hidden by a moderator stays hidden. */
export async function rate(
  db: Database,
  input: { videoId: string; userId: string; stars: number; review?: string | null },
  now: Date = new Date(),
) {
  if (!Number.isInteger(input.stars) || input.stars < 1 || input.stars > 5) throw new RangeError("stars must be 1-5");
  const review = input.review?.trim().slice(0, RATING_POLICY.maxReviewChars) || null;
  return db.transaction(async (tx) => {
    // Lock the video so concurrent ratings recompute the aggregate one at a time.
    await tx.select({ id: videos.id }).from(videos).where(eq(videos.id, input.videoId)).for("update");
    const blocker = await ratingBlocker(tx, input.userId, input.videoId);
    if (blocker) throw new RatingError(blocker.reason, blocker.message);
    const [row] = await tx
      .insert(ratings)
      .values({ videoId: input.videoId, userId: input.userId, stars: input.stars, review, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({ target: [ratings.videoId, ratings.userId], set: { stars: input.stars, review, updatedAt: now } })
      .returning();
    await refreshAggregates(tx, input.videoId);
    return row!;
  });
}

export async function removeRating(db: Database, videoId: string, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.select({ id: videos.id }).from(videos).where(eq(videos.id, videoId)).for("update");
    await tx.delete(ratings).where(and(eq(ratings.videoId, videoId), eq(ratings.userId, userId)));
    await refreshAggregates(tx, videoId);
  });
}

/** Mark a review helpful, or take the vote back. Returns the new state. */
export async function setHelpful(db: Database, ratingId: string, userId: string, helpful: boolean): Promise<{ helpful: boolean; helpfulCount: number }> {
  return db.transaction(async (tx) => {
    const [rating] = await tx.select({ userId: ratings.userId }).from(ratings).where(eq(ratings.id, ratingId)).for("update");
    if (!rating) throw new RatingError("not_found", "Review not found.");
    if (rating.userId === userId) throw new RatingError("own_review", "You can't vote on your own review.");
    if (helpful) await tx.insert(reviewHelpfulVotes).values({ ratingId, userId }).onConflictDoNothing();
    else await tx.delete(reviewHelpfulVotes).where(and(eq(reviewHelpfulVotes.ratingId, ratingId), eq(reviewHelpfulVotes.userId, userId)));
    const [updated] = await tx
      .update(ratings)
      .set({ helpfulCount: sql`(select count(*)::int from ${reviewHelpfulVotes} where ${reviewHelpfulVotes.ratingId} = ${ratingId})` })
      .where(eq(ratings.id, ratingId))
      .returning({ helpfulCount: ratings.helpfulCount });
    return { helpful, helpfulCount: updated!.helpfulCount };
  });
}

/** Average, count and the 1-5 star distribution. */
export async function ratingSummary(db: Database, videoId: string) {
  const rows = await db
    .select({ stars: ratings.stars, count: sql<number>`count(*)::int` })
    .from(ratings)
    .where(eq(ratings.videoId, videoId))
    .groupBy(ratings.stars);
  const distribution = [5, 4, 3, 2, 1].map((stars) => ({ stars, count: rows.find((r) => r.stars === stars)?.count ?? 0 }));
  const count = distribution.reduce((sum, d) => sum + d.count, 0);
  const average = count ? distribution.reduce((sum, d) => sum + d.stars * d.count, 0) / count : null;
  return { average, count, distribution };
}

/** "Marcus Reid" -> "Marcus R.": enough to be a person, not enough to be found. */
export function reviewerName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "A father";
  return parts.length === 1 ? parts[0]! : `${parts[0]} ${parts.at(-1)![0]!.toUpperCase()}.`;
}

export type ReviewSort = "helpful" | "newest";

/** Visible written reviews for a video, with whether the viewer found each helpful. */
export async function listReviews(
  db: Database,
  videoId: string,
  options: { sort?: ReviewSort; viewerId?: string | null; limit?: number; offset?: number } = {},
) {
  const viewerId = options.viewerId ?? null;
  const where = and(eq(ratings.videoId, videoId), isNotNull(ratings.review), isNull(ratings.reviewHiddenAt));
  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: ratings.id,
        stars: ratings.stars,
        review: ratings.review,
        helpfulCount: ratings.helpfulCount,
        createdAt: ratings.createdAt,
        updatedAt: ratings.updatedAt,
        authorId: ratings.userId,
        authorName: user.name,
        votedHelpful: viewerId
          ? sql<boolean>`exists (select 1 from ${reviewHelpfulVotes} where ${reviewHelpfulVotes.ratingId} = ${ratings.id} and ${reviewHelpfulVotes.userId} = ${viewerId})`
          : sql<boolean>`false`,
      })
      .from(ratings)
      .innerJoin(user, eq(ratings.userId, user.id))
      .where(where)
      .orderBy(...(options.sort === "newest" ? [desc(ratings.createdAt)] : [desc(ratings.helpfulCount), desc(ratings.createdAt)]))
      .limit(options.limit ?? 10)
      .offset(options.offset ?? 0),
    db.select({ n: sql<number>`count(*)::int` }).from(ratings).where(where),
  ]);
  return {
    total: total?.n ?? 0,
    reviews: rows.map(({ authorId, authorName, ...r }) => ({
      ...r,
      review: r.review!,
      author: reviewerName(authorName),
      isOwn: authorId === viewerId,
    })),
  };
}

export async function myRating(db: Database, videoId: string, userId: string) {
  const [row] = await db
    .select({ stars: ratings.stars, review: ratings.review, reviewHidden: sql<boolean>`${ratings.reviewHiddenAt} is not null` })
    .from(ratings)
    .where(and(eq(ratings.videoId, videoId), eq(ratings.userId, userId)));
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Moderation
// ---------------------------------------------------------------------------

/** Recent written reviews across the site, newest first, for admins. */
export async function recentReviews(db: Database, options: { hiddenOnly?: boolean; limit?: number } = {}) {
  return db
    .select({
      id: ratings.id,
      stars: ratings.stars,
      review: ratings.review,
      createdAt: ratings.createdAt,
      hiddenAt: ratings.reviewHiddenAt,
      authorName: user.name,
      authorEmail: user.email,
      videoId: videos.id,
      videoTitle: videos.title,
      videoType: videos.type,
    })
    .from(ratings)
    .innerJoin(user, eq(ratings.userId, user.id))
    .innerJoin(videos, eq(ratings.videoId, videos.id))
    .where(and(isNotNull(ratings.review), options.hiddenOnly ? isNotNull(ratings.reviewHiddenAt) : undefined))
    .orderBy(desc(ratings.createdAt))
    .limit(options.limit ?? 50);
}

/** Hide or restore a written review. The stars keep counting either way. */
export async function setReviewHidden(db: Database, ratingId: string, hidden: boolean, adminId: string, now: Date = new Date()) {
  const [row] = await db
    .update(ratings)
    .set(hidden ? { reviewHiddenAt: now, reviewHiddenById: adminId } : { reviewHiddenAt: null, reviewHiddenById: null })
    .where(eq(ratings.id, ratingId))
    .returning({ id: ratings.id });
  if (!row) throw new RatingError("not_found", "Review not found.");
}
