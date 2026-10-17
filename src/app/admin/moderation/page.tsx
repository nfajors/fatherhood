import type { Metadata } from "next";
import Link from "next/link";
import { BulkApproveButton } from "@/components/admin/moderation-actions";
import { RiskBadge, SlaBadge } from "@/components/admin/moderation-badges";
import { Card } from "@/components/ui/card";
import { getDb } from "@/lib/db";
import { themeClassifierConfigured } from "@/lib/env";
import { MODERATION_POLICY, REPORT_REASONS, type ReportReason } from "@/lib/moderation/policy";
import { moderationSummary, reportQueue, reviewQueue } from "@/lib/moderation/service";

export const metadata: Metadata = { title: "Moderation (admin)", robots: { index: false } };
export const dynamic = "force-dynamic";

const minutes = (s: number | null) => (s ? `${Math.max(1, Math.round(s / 60))} min` : "length unknown");

export default async function ModerationPage() {
  const db = getDb();
  const [summary, queue, reported] = await Promise.all([moderationSummary(db), reviewQueue(db), reportQueue(db)]);
  const recommended = queue.filter((q) => q.aiRecommendation === "approve" && q.aiRisk === "low").map((q) => q.id);

  const tiles = [
    { label: "Waiting for review", value: summary.pending },
    { label: "Overdue", value: summary.overdue, alert: summary.overdue > 0 },
    { label: "Due within 24 hours", value: summary.dueSoon },
    { label: "Awaiting AI screen", value: summary.awaitingScreen },
    { label: "Reported videos", value: summary.openReports, alert: summary.openReports > 0 },
    { label: "Changes requested", value: summary.changesRequested },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-semibold">Moderation</h1>
      <p className="mt-2 max-w-3xl text-muted">
        Every new video is screened by AI, then reviewed here. Community videos are due within{" "}
        {MODERATION_POLICY.reviewSlaHours.community} hours. Clean, relevant Community videos from creators with an earlier
        approved video publish automatically.
        {!themeClassifierConfigured() && " The AI screen is off until ANTHROPIC_API_KEY is set."}
      </p>

      <dl className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl border border-navy-900/10 bg-white p-4">
            <dt className="text-xs text-muted">{t.label}</dt>
            <dd className={`mt-1 font-serif text-3xl ${t.alert ? "text-red-700" : "text-navy-900"}`}>{t.value}</dd>
          </div>
        ))}
      </dl>

      <section className="mt-12" aria-labelledby="queue">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="queue" className="text-2xl font-semibold">
            Review queue
          </h2>
          <BulkApproveButton videoIds={recommended} />
        </div>
        {queue.length === 0 ? (
          <p className="mt-4 text-muted">Nothing waiting. Nice work.</p>
        ) : (
          <ul className="mt-4 divide-y divide-navy-900/10 rounded-xl border border-navy-900/10 bg-white">
            {queue.map((item) => (
              <li key={item.id}>
                <Link href={`/admin/moderation/${item.id}`} className="flex gap-4 p-4 hover:bg-paper">
                  {item.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- Stream thumbnail
                    <img src={item.thumbnailUrl} alt="" className="hidden aspect-video w-36 shrink-0 rounded-md object-cover sm:block" />
                  ) : (
                    <div className="hidden aspect-video w-36 shrink-0 rounded-md bg-navy-100 sm:block" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-navy-900">{item.title}</p>
                    <p className="text-sm text-muted">
                      {item.creatorName} · {item.type === "community" ? "Community" : "Professional"} · {minutes(item.durationSeconds)}
                    </p>
                    {item.summary && <p className="mt-1 line-clamp-2 text-sm text-ink">{item.summary}</p>}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <RiskBadge risk={item.aiRisk} recommendation={item.aiRecommendation} />
                      <SlaBadge sla={item.sla} dueAt={item.reviewDueAt} />
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-12" aria-labelledby="reports">
        <h2 id="reports" className="text-2xl font-semibold">
          Reported videos
        </h2>
        {reported.length === 0 ? (
          <p className="mt-4 text-muted">No open reports.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {reported.map((r) => (
              <li key={r.id}>
                <Card className="p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <Link href={`/admin/moderation/${r.id}`} className="font-semibold text-navy-900 underline-offset-4 hover:underline">
                      {r.title}
                    </Link>
                    <span className="text-sm text-muted">
                      {r.reporters} {r.reporters === 1 ? "reporter" : "reporters"} · {r.status === "unpublished" ? "hidden" : r.status}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-ink">
                    {r.reasons.map((reason) => REPORT_REASONS[reason as ReportReason] ?? reason).join(" · ")}
                  </p>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
