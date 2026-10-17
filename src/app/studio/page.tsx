import type { Metadata } from "next";
import Link from "next/link";
import { EligibilityChecklist, Stat } from "@/components/studio/earnings";
import { StatusBadge } from "@/components/studio/status-badge";
import { ViewsChart } from "@/components/studio/views-chart";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getSessionUser } from "@/lib/auth";
import { dailyViews, earningsEstimate, studioSummary, studioVideos } from "@/lib/creators/dashboard";
import { getDb } from "@/lib/db";
import { formatCount, formatDuration, formatMoney, formatWatchTime } from "@/lib/format";

export const metadata: Metadata = { title: "Studio", robots: { index: false } };

const monthName = (d: Date) => d.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });

export default async function StudioPage() {
  const sessionUser = (await getSessionUser())!;
  const db = getDb();
  const [summary, list, days, estimate] = await Promise.all([
    studioSummary(db, sessionUser.id),
    studioVideos(db, sessionUser.id),
    dailyViews(db, sessionUser.id),
    earningsEstimate(db, sessionUser.id),
  ]);
  const attention = list.filter((v) => v.status === "changes_requested" || v.status === "failed" || v.status === "uploading");

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-semibold">Your Studio</h1>
          <p className="mt-2 text-muted">Your videos, how they&apos;re doing, and what you&apos;ve earned.</p>
        </div>
        <Button asChild>
          <Link href="/studio/upload">Upload a video</Link>
        </Button>
      </div>

      {attention.length > 0 && (
        <section aria-labelledby="attention" className="mt-8 rounded-xl border border-amber-200 bg-amber-50 p-5">
          <h2 id="attention" className="font-semibold text-amber-950">
            <span aria-hidden>! </span>
            {attention.length === 1 ? "1 video needs you" : `${attention.length} videos need you`}
          </h2>
          <ul className="mt-2 space-y-1 text-sm">
            {attention.map((v) => (
              <li key={v.id}>
                <Link href={`/studio/videos/${v.id}`} className="font-medium underline-offset-2 hover:underline">
                  {v.title}
                </Link>{" "}
                <span className="text-amber-950/80">
                  ·{" "}
                  {v.status === "changes_requested"
                    ? `changes requested${v.lastDecision?.notes ? `: “${v.lastDecision.notes}”` : ""}`
                    : v.status === "failed"
                      ? "the upload failed; try again"
                      : "the file hasn't finished uploading"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Totals" className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Published videos" value={String(summary.published)} detail={summary.inReview ? `${summary.inReview} uploading or in review` : undefined} />
        <Stat label="Views" value={formatCount(summary.views)} detail={`${formatCount(summary.recentViews)} in the last 30 days`} />
        <Stat label="Watch time" value={formatWatchTime(summary.watchSeconds)} detail={`${formatWatchTime(summary.recentWatchSeconds)} in the last 30 days`} />
        <Stat
          label="Rating"
          value={summary.ratingAverage ? `${summary.ratingAverage.toFixed(1)} ★` : "–"}
          detail={summary.ratingCount ? `${summary.ratingCount} ${summary.ratingCount === 1 ? "rating" : "ratings"}` : "No ratings yet"}
        />
      </section>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Card>
          <h2 className="text-lg font-semibold">Views, last 30 days</h2>
          <p className="mt-1 text-sm text-muted">A view counts once someone watches at least 30 seconds.</p>
          <div className="mt-6">
            <ViewsChart days={days} />
          </div>
        </Card>
        <Card>
          <h2 className="text-lg font-semibold">{monthName(estimate.month.start)} so far</h2>
          <p className="mt-4 text-4xl font-semibold tabular-nums">{formatMoney(estimate.estimatedCents)}</p>
          <p className="mt-1 text-sm text-muted">Estimated share of the creator pool. It changes until the month closes.</p>
          <EligibilityChecklist estimate={estimate} className="mt-5" />
          <Link href="/studio/earnings" className="mt-5 inline-block text-sm font-semibold underline-offset-2 hover:underline">
            Earnings and payouts →
          </Link>
        </Card>
      </div>

      <section aria-labelledby="videos" className="mt-10">
        <h2 id="videos" className="text-2xl font-semibold">
          Your videos
        </h2>
        {list.length === 0 ? (
          <Card className="mt-4">
            <p className="text-muted">No videos yet. Share a story from your own fathering: up to 8 minutes, filmed on your phone is fine.</p>
            <Button asChild className="mt-4">
              <Link href="/studio/upload">Upload your first video</Link>
            </Button>
          </Card>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-xl border border-navy-900/10 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-navy-900/10 text-muted">
                <tr>
                  <th className="px-4 py-3 font-normal">Video</th>
                  <th className="px-2 py-3 font-normal sm:px-4">Status</th>
                  <th className="px-4 py-3 text-right font-normal">Views</th>
                  <th className="hidden px-4 py-3 text-right font-normal sm:table-cell">Watch time</th>
                  <th className="hidden px-4 py-3 text-right font-normal sm:table-cell">Rating</th>
                </tr>
              </thead>
              <tbody>
                {list.map((v) => (
                  <tr key={v.id} className="border-t border-navy-900/5 align-top">
                    <td className="px-4 py-3">
                      <Link href={`/studio/videos/${v.id}`} className="font-medium underline-offset-2 hover:underline">
                        {v.title}
                      </Link>
                      <span className="block text-xs text-muted">
                        {v.type === "professional" ? "Academy lesson" : "Community Voices"}
                        {v.durationSeconds ? ` · ${formatDuration(v.durationSeconds)}` : ""}
                        {" · "}
                        {(v.publishedAt ?? v.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </span>
                    </td>
                    <td className="px-2 py-3 sm:px-4">
                      <StatusBadge status={v.status} />
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatCount(v.views)}</td>
                    <td className="hidden px-4 py-3 text-right tabular-nums sm:table-cell">{formatWatchTime(v.watchSeconds)}</td>
                    <td className="hidden px-4 py-3 text-right tabular-nums sm:table-cell">
                      {v.ratingCount ? `${Number(v.ratingAverage).toFixed(1)} (${v.ratingCount})` : "–"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
