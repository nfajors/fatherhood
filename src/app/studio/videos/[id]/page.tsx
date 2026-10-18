import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Stat } from "@/components/studio/earnings";
import { STATUS_COPY, StatusBadge } from "@/components/studio/status-badge";
import { DeleteVideoButton, EditDetailsForm, ReplaceFile, ResubmitForm } from "@/components/studio/video-actions";
import { PlayerUnavailable, VideoPlayer } from "@/components/video/video-player";
import { Card } from "@/components/ui/card";
import { getSessionUser } from "@/lib/auth";
import { studioVideo } from "@/lib/creators/dashboard";
import { allows } from "@/lib/creators/videos";
import { getDb } from "@/lib/db";
import type { VideoReviewAction } from "@/lib/db/schema";
import { formatCount, formatDuration, formatWatchTime } from "@/lib/format";
import { accessFor, loadViewer, playbackSource } from "@/lib/playback/access";

export const metadata: Metadata = { title: "Video (Studio)", robots: { index: false } };

/** History as the creator reads it. */
const EVENT: Record<Exclude<VideoReviewAction, "ai_screen">, string> = {
  approve: "Approved and published",
  auto_approve: "Approved and published",
  reject: "Not approved",
  request_changes: "Changes requested",
  unpublish: "Taken down",
  restore: "Published again",
  resubmit: "You resubmitted it",
};

/** Statuses where Stream has a playable file. */
const PLAYABLE = new Set(["pending_review", "approved", "changes_requested", "rejected", "unpublished"]);

export default async function StudioVideoPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ uploaded?: string }> }) {
  const [{ id }, { uploaded }] = await Promise.all([params, searchParams]);
  if (!z.uuid().safeParse(id).success) notFound();
  const sessionUser = (await getSessionUser())!;
  const db = getDb();
  const detail = await studioVideo(db, sessionUser.id, id);
  if (!detail) notFound();
  const { video, history, watchSeconds } = detail;

  let source = null;
  if (PLAYABLE.has(video.status)) {
    const decision = await accessFor(db, video, await loadViewer(db, sessionUser));
    if (decision.allowed) source = await playbackSource(video, decision);
  }
  const latestRequest = history.find((h) => h.action === "request_changes");
  const status = STATUS_COPY[video.status];
  const replaceable = allows("upload", video.status) ? (video.status as "uploading" | "changes_requested" | "failed") : null;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <Link href="/studio" className="text-sm text-muted underline underline-offset-2">
        ← Your Studio
      </Link>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">{video.title}</h1>
          <p className="mt-1 text-sm text-muted">
            {video.type === "professional" ? "Academy lesson" : "Community Voices"}
            {video.durationSeconds ? ` · ${formatDuration(video.durationSeconds)}` : ""}
            {video.status === "approved" && video.type === "community" && (
              <>
                {" · "}
                <Link href={`/community/${video.id}`} className="underline underline-offset-2">
                  View public page
                </Link>
              </>
            )}
          </p>
        </div>
        <StatusBadge status={video.status} className="text-sm" />
      </div>

      {uploaded && (video.status === "uploading" || video.status === "processing") && (
        <p role="status" className="mt-6 rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          ✓ Uploaded. Cloudflare is processing it; this page updates when you reload it.
        </p>
      )}

      <Card className="mt-6">
        <p className="font-semibold">{status.label}</p>
        <p className="mt-1 text-sm text-muted">{status.hint}</p>
        {video.status === "changes_requested" && latestRequest?.notes && (
          <blockquote className="mt-4 border-l-4 border-gold-500 bg-gold-100/40 px-4 py-3 text-sm">
            <span className="block text-xs font-semibold uppercase tracking-wide text-muted">What to change</span>
            <span className="mt-1 block whitespace-pre-line">{latestRequest.notes}</span>
          </blockquote>
        )}
        {(video.status === "rejected" || video.status === "unpublished") && history[0]?.notes && (
          <blockquote className="mt-4 border-l-4 border-red-300 bg-red-50 px-4 py-3 text-sm">
            <span className="block text-xs font-semibold uppercase tracking-wide text-muted">Why</span>
            <span className="mt-1 block whitespace-pre-line">{history[0].notes}</span>
          </blockquote>
        )}
        {video.status === "changes_requested" && (
          <div className="mt-6 border-t border-navy-900/10 pt-6">
            <p className="mb-4 text-sm">
              Fix the details below and resubmit, or upload a new version of the video further down.
            </p>
            <ResubmitForm videoId={video.id} />
          </div>
        )}
      </Card>

      {source ? (
        <div className="mt-6">
          <VideoPlayer videoId={video.id} src={source.src} customerCode={source.customerCode} title={video.title} poster={video.thumbnailUrl} />
          <p className="mt-2 text-xs text-muted">Your own viewing doesn&apos;t count toward your views.</p>
        </div>
      ) : (
        PLAYABLE.has(video.status) && (
          <div className="mt-6">
            <PlayerUnavailable poster={video.thumbnailUrl} />
          </div>
        )
      )}

      {video.status === "approved" || video.status === "unpublished" ? (
        <section aria-label="Numbers" className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Stat label="Views" value={formatCount(video.viewCount)} />
          <Stat label="Watch time" value={formatWatchTime(watchSeconds)} />
          <Stat label="Rating" value={video.ratingCount ? `${Number(video.ratingAverage).toFixed(1)} ★` : "–"} detail={video.ratingCount ? `${video.ratingCount} ratings` : "No ratings yet"} />
        </section>
      ) : null}

      {replaceable && (
        <Card className="mt-6">
          <ReplaceFile videoId={video.id} type={video.type} status={replaceable} />
        </Card>
      )}

      {allows("edit", video.status) && (
        <Card className="mt-6">
          <h2 className="mb-4 text-lg font-semibold">Details</h2>
          <EditDetailsForm video={video} />
        </Card>
      )}

      {history.length > 0 && (
        <section aria-labelledby="history" className="mt-8">
          <h2 id="history" className="text-lg font-semibold">
            History
          </h2>
          <ol className="mt-3 space-y-3 border-l border-navy-900/10 pl-4 text-sm">
            {history.map((h, i) => (
              <li key={i}>
                <span className="font-medium">{h.action === "ai_screen" ? "" : EVENT[h.action]}</span>
                <span className="text-muted"> · {h.at.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</span>
                {h.notes && <p className="mt-1 whitespace-pre-line text-muted">{h.notes}</p>}
              </li>
            ))}
            <li>
              <span className="font-medium">Created</span>
              <span className="text-muted"> · {video.createdAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</span>
            </li>
          </ol>
        </section>
      )}

      {allows("delete", video.status) && (
        <div className="mt-10 border-t border-navy-900/10 pt-6">
          <DeleteVideoButton videoId={video.id} title={video.title} />
        </div>
      )}
    </div>
  );
}
