import Link from "next/link";
import type { SessionUser } from "@/lib/auth";
import type { Database } from "@/lib/db";
import { RATING_POLICY } from "@/lib/ratings/policy";
import { listReviews, myRating, ratingBlocker, ratingSummary, type ReviewSort } from "@/lib/ratings/service";
import { cn } from "@/lib/utils";
import { HelpfulButton } from "./helpful-button";
import { RatingForm } from "./rating-form";
import { RatingSummary } from "./rating-summary";
import { Stars } from "./stars";

const REVIEWS_SHOWN = 10;
const REVIEWS_ALL = 200;

/**
 * Ratings and reviews under a player: the summary, the viewer's own rating,
 * and written reviews sorted by helpfulness or date (`?reviews=newest`).
 */
export async function RatingsSection({
  db,
  videoId,
  viewer,
  sort,
  showAll = false,
  path,
}: {
  db: Database;
  videoId: string;
  viewer: SessionUser | null;
  sort: ReviewSort;
  /** `?all=1`: every review rather than the first ten. */
  showAll?: boolean;
  /** This page's path, for the sort links and sign-in return. */
  path: string;
}) {
  const [summary, mine, blocker, { reviews, total }] = await Promise.all([
    ratingSummary(db, videoId),
    viewer ? myRating(db, videoId, viewer.id) : null,
    viewer ? ratingBlocker(db, viewer.id, videoId) : null,
    listReviews(db, videoId, { sort, viewerId: viewer?.id, limit: showAll ? REVIEWS_ALL : REVIEWS_SHOWN }),
  ]);

  return (
    <section aria-labelledby="ratings" className="mt-10 border-t border-navy-900/10 pt-8">
      <h2 id="ratings" className="text-xl font-semibold">
        Ratings and reviews
      </h2>
      <div className="mt-5 grid gap-8 lg:grid-cols-2">
        <RatingSummary summary={summary} />
        <div>
          {!viewer ? (
            <p className="text-sm text-muted">
              <Link href={`/sign-in?next=${encodeURIComponent(path)}`} className="font-medium text-navy-900 underline underline-offset-2">
                Sign in
              </Link>{" "}
              to rate this video.
            </p>
          ) : blocker?.reason === "own_video" ? (
            <p className="text-sm text-muted">This is your video, so you can&apos;t rate it. Its ratings are in your Studio.</p>
          ) : (
            <RatingForm
              videoId={videoId}
              current={mine}
              hint={!mine && blocker?.reason === "not_watched" ? "Watch at least 30 seconds before rating." : null}
              maxChars={RATING_POLICY.maxReviewChars}
            />
          )}
        </div>
      </div>

      {total > 0 && (
        <div className="mt-8">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h3 className="font-semibold">
              {total} {total === 1 ? "review" : "reviews"}
            </h3>
            <nav aria-label="Sort reviews" className="flex gap-2 text-sm">
              {(
                [
                  ["helpful", "Most helpful"],
                  ["newest", "Newest"],
                ] as const
              ).map(([value, label]) => (
                <Link
                  key={value}
                  href={value === "helpful" ? `${path}#ratings` : `${path}?reviews=${value}#ratings`}
                  aria-current={sort === value ? "true" : undefined}
                  className={cn("rounded-full px-3 py-1", sort === value ? "bg-navy-900 text-white" : "text-navy-900 hover:bg-navy-100")}
                  scroll={false}
                >
                  {label}
                </Link>
              ))}
            </nav>
          </div>
          <ul className="mt-4 divide-y divide-navy-900/10">
            {reviews.map((r) => (
              <li key={r.id} className="py-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Stars value={r.stars} className="text-sm" />
                  <span className="text-sm font-medium">{r.author}</span>
                  <span className="text-xs text-muted">{r.createdAt.toLocaleDateString("en-US", { dateStyle: "medium" })}</span>
                </div>
                <p className="mt-2 whitespace-pre-line text-sm">{r.review}</p>
                {!r.isOwn && (
                  <div className="mt-2">
                    <HelpfulButton ratingId={r.id} initialCount={r.helpfulCount} initialVoted={r.votedHelpful} signedIn={Boolean(viewer)} />
                  </div>
                )}
              </li>
            ))}
          </ul>
          {total > reviews.length && (
            <Link
              href={`${path}?${new URLSearchParams({ ...(sort === "newest" ? { reviews: sort } : {}), all: "1" })}#ratings`}
              scroll={false}
              className="mt-2 inline-block text-sm font-semibold underline-offset-2 hover:underline"
            >
              Show all {total} reviews
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
