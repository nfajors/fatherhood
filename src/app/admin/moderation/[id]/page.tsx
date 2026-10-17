import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { RescreenButton, ResolveReportsButtons, ReviewActions } from "@/components/admin/moderation-actions";
import { RiskBadge, SlaBadge } from "@/components/admin/moderation-badges";
import { Card } from "@/components/ui/card";
import { getDb } from "@/lib/db";
import type { VideoReviewAction } from "@/lib/db/schema";
import { themeClassifierConfigured } from "@/lib/env";
import { slaState } from "@/lib/moderation/decide";
import { REPORT_REASONS, RISK_CATEGORIES, type ReportReason, type RiskCategory } from "@/lib/moderation/policy";
import { reviewDetail } from "@/lib/moderation/service";
import { signPlaybackToken, streamFromEnv } from "@/lib/stream";

export const metadata: Metadata = { title: "Review video (admin)", robots: { index: false } };
export const dynamic = "force-dynamic";

const ACTION_LABEL: Record<VideoReviewAction, string> = {
  ai_screen: "AI / system",
  auto_approve: "Auto-approved",
  approve: "Approved",
  reject: "Rejected",
  request_changes: "Changes requested",
  unpublish: "Unpublished",
  restore: "Restored",
  resubmit: "Resubmitted by creator",
};

const LEVEL_STYLE: Record<string, string> = {
  none: "text-muted",
  low: "text-emerald-800",
  medium: "font-semibold text-amber-800",
  high: "font-semibold text-red-700",
};

/** Stream player URL for admins; null when Stream isn't configured (e.g. local development). */
async function playerUrl(uid: string | null, signed: boolean): Promise<string | null> {
  if (!uid) return null;
  try {
    const { env, client } = await streamFromEnv();
    const ref = signed
      ? await signPlaybackToken({ videoUid: uid, keyId: env.CLOUDFLARE_STREAM_SIGNING_KEY_ID, jwkBase64: env.CLOUDFLARE_STREAM_SIGNING_KEY_JWK, ttlSeconds: 3600 })
      : uid;
    return client.playbackUrls(ref).iframe;
  } catch {
    return null;
  }
}

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const detail = await reviewDetail(getDb(), id);
  if (!detail) notFound();
  const { video, creator, screen, history, reports, themes } = detail;
  const player = await playerUrl(video.cloudflareUid, video.requireSignedUrls);
  const openReports = reports.filter((r) => r.status === "open");

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <Link href="/admin/moderation" className="text-sm text-muted underline">
        ← Moderation queue
      </Link>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-semibold">{video.title}</h1>
        <span className="rounded bg-navy-100 px-2 py-0.5 text-xs text-navy-900">{video.status.replace("_", " ")}</span>
      </div>
      <p className="mt-1 text-muted">
        {creator.name} ({creator.email}) · {video.type === "community" ? "Community Voices" : "Professional"}
        {video.durationSeconds ? ` · ${Math.round(video.durationSeconds / 60)} min` : ""}
      </p>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-8">
          <div className="aspect-video overflow-hidden rounded-xl bg-navy-950">
            {player ? (
              <iframe src={player} title={`Video: ${video.title}`} className="h-full w-full" allow="autoplay; fullscreen; picture-in-picture" allowFullScreen />
            ) : video.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- Stream thumbnail
              <img src={video.thumbnailUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <p className="flex h-full items-center justify-center text-sm text-white/70">Player unavailable</p>
            )}
          </div>

          <section aria-labelledby="ai">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="ai" className="text-xl font-semibold">
                AI screen
              </h2>
              {themeClassifierConfigured() && <RescreenButton videoId={video.id} />}
            </div>
            {!screen ? (
              <p className="mt-3 text-muted">
                {video.captionsRequestedAt ? "Waiting for the transcript before screening." : "Not screened yet."}
              </p>
            ) : screen.kind === "declined" ? (
              <Card className="mt-3 border-red-200">
                <p className="font-semibold text-red-700">The AI declined to assess this video{screen.category ? ` (${screen.category})` : ""}.</p>
                <p className="mt-1 text-sm text-muted">Treat it as high risk and review it carefully.</p>
              </Card>
            ) : (
              <Card className="mt-3 space-y-4">
                <div className="flex flex-wrap gap-2">
                  <RiskBadge risk={video.aiRisk} recommendation={video.aiRecommendation} />
                  <span className="rounded bg-navy-100 px-2 py-0.5 text-xs text-navy-900">Relevance {screen.relevance}/100</span>
                  {!screen.hadTranscript && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900">No transcript</span>}
                </div>
                <p className="text-ink">{screen.summary}</p>
                <p className="text-sm text-muted">{screen.recommendation_reason}</p>
                {screen.concerns.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold">Concerns</h3>
                    <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                      {screen.concerns.map((c, i) => (
                        <li key={i}>
                          {c.timestamp && <span className="font-mono text-muted">{c.timestamp} </span>}
                          <span className="font-semibold">{RISK_CATEGORIES[c.category as RiskCategory] ?? c.category}:</span> {c.explanation}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <details>
                  <summary className="cursor-pointer text-sm font-semibold">Every policy area</summary>
                  <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
                    {Object.entries(screen.categories).map(([k, level]) => (
                      <div key={k} className="contents">
                        <dt>{RISK_CATEGORIES[k as RiskCategory]}</dt>
                        <dd className={LEVEL_STYLE[level]}>{level}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
                {screen.quality_notes.length > 0 && <p className="text-sm text-muted">Quality: {screen.quality_notes.join("; ")}</p>}
                {screen.autoApprovalBlockers && screen.autoApprovalBlockers.length > 0 && video.status === "pending_review" && (
                  <p className="text-sm text-muted">Not auto-approved: {screen.autoApprovalBlockers.join(" ")}</p>
                )}
              </Card>
            )}
          </section>

          {video.description && (
            <section aria-labelledby="desc">
              <h2 id="desc" className="text-xl font-semibold">
                Description
              </h2>
              <p className="mt-2 whitespace-pre-line text-ink">{video.description}</p>
            </section>
          )}

          <section aria-labelledby="transcript">
            <h2 id="transcript" className="text-xl font-semibold">
              Transcript
            </h2>
            {video.transcript ? (
              <details className="mt-2">
                <summary className="cursor-pointer text-sm text-muted">Show transcript ({video.transcript.split(/\s+/).length} words)</summary>
                <p className="mt-2 max-h-96 overflow-y-auto whitespace-pre-line rounded-md bg-white p-4 text-sm text-ink">{video.transcript}</p>
              </details>
            ) : (
              <p className="mt-2 text-sm text-muted">No transcript yet.</p>
            )}
          </section>
        </div>

        <aside className="space-y-6">
          <Card>
            <h2 className="text-lg font-semibold">Decision</h2>
            {video.status === "pending_review" && (
              <div className="mt-2">
                <SlaBadge sla={slaState(video.reviewDueAt)} dueAt={video.reviewDueAt} />
              </div>
            )}
            <div className="mt-4">
              <ReviewActions videoId={video.id} status={video.status} />
            </div>
          </Card>

          {openReports.length > 0 && (
            <Card className="border-red-200">
              <h2 className="text-lg font-semibold">Open reports ({openReports.length})</h2>
              <ul className="mt-2 space-y-2 text-sm">
                {openReports.map((r) => (
                  <li key={r.id}>
                    <span className="font-semibold">{REPORT_REASONS[r.reason as ReportReason] ?? r.reason}</span>
                    {r.details && <span className="text-muted">: {r.details}</span>}
                  </li>
                ))}
              </ul>
              <div className="mt-4">
                <ResolveReportsButtons videoId={video.id} />
              </div>
            </Card>
          )}

          <Card>
            <h2 className="text-lg font-semibold">Themes</h2>
            {themes.length === 0 ? (
              <p className="mt-2 text-sm text-muted">Not placed in a theme yet.</p>
            ) : (
              <ul className="mt-2 flex flex-wrap gap-2">
                {themes.map((t) => (
                  <li key={t.name} className="rounded-full border border-navy-900/15 px-3 py-1 text-sm">
                    {t.name}
                    {t.isPrimary && " ★"}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h2 className="text-lg font-semibold">History</h2>
            <ol className="mt-2 space-y-3 text-sm">
              {history.map((h) => (
                <li key={h.id}>
                  <p>
                    <span className="font-semibold">{ACTION_LABEL[h.action] ?? h.action}</span>
                    {h.reviewer && <span className="text-muted"> by {h.reviewer}</span>}
                    <span className="text-muted"> · {h.createdAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</span>
                  </p>
                  {h.notes && <p className="text-muted">{h.notes}</p>}
                </li>
              ))}
            </ol>
          </Card>
        </aside>
      </div>
    </div>
  );
}
