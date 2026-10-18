import type { Metadata } from "next";
import Link from "next/link";
import { ReviewVisibilityButton } from "@/components/admin/review-actions";
import { Stars } from "@/components/ratings/stars";
import { getDb } from "@/lib/db";
import { recentReviews } from "@/lib/ratings/service";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Reviews (admin)", robots: { index: false } };

export default async function AdminReviewsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const { show } = await searchParams;
  const hiddenOnly = show === "hidden";
  const reviews = await recentReviews(getDb(), { hiddenOnly, limit: 100 });

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-semibold">Reviews</h1>
      <p className="mt-2 text-muted">Written reviews, newest first. Hiding a review removes its text from the site; its stars still count toward the rating.</p>
      <nav aria-label="Filter" className="mt-6 flex gap-2 text-sm">
        {(
          [
            [undefined, "Recent"],
            ["hidden", "Hidden"],
          ] as const
        ).map(([value, label]) => (
          <Link
            key={label}
            href={value ? `/admin/reviews?show=${value}` : "/admin/reviews"}
            aria-current={show === value ? "page" : undefined}
            className={cn("rounded-full px-3 py-1", show === value ? "bg-navy-900 text-white" : "border border-navy-900/15 bg-white")}
          >
            {label}
          </Link>
        ))}
      </nav>
      {reviews.length === 0 ? (
        <p className="mt-6 text-sm text-muted">{hiddenOnly ? "No hidden reviews." : "No reviews yet."}</p>
      ) : (
        <ul className="mt-6 divide-y divide-navy-900/10 rounded-xl border border-navy-900/10 bg-white">
          {reviews.map((r) => (
            <li key={r.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <Stars value={r.stars} />
                    <span className="font-medium">{r.authorName}</span>
                    <span className="text-muted">{r.authorEmail}</span>
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    on{" "}
                    <Link href={r.videoType === "community" ? `/community/${r.videoId}` : `/admin/moderation/${r.videoId}`} className="underline">
                      {r.videoTitle}
                    </Link>{" "}
                    · {r.createdAt.toLocaleDateString("en-US", { dateStyle: "medium" })}
                    {r.hiddenAt && <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 font-semibold text-red-800">Hidden</span>}
                  </p>
                </div>
                <ReviewVisibilityButton ratingId={r.id} hidden={Boolean(r.hiddenAt)} />
              </div>
              <p className={cn("mt-2 whitespace-pre-line text-sm", r.hiddenAt && "text-muted line-through")}>{r.review}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
