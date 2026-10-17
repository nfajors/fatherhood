import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { VideoCardView } from "@/components/catalog/cards";
import { PlayerUnavailable, VideoPlayer } from "@/components/video/video-player";
import { ReportButton } from "@/components/video/report-button";
import { getSessionUser } from "@/lib/auth";
import { getCommunityVideo, relatedCommunityVideos } from "@/lib/courses/catalog";
import { getDb } from "@/lib/db";
import { formatDuration } from "@/lib/format";
import { accessFor, loadViewer, playbackSource } from "@/lib/playback/access";
import { resumeAt } from "@/lib/playback/progress";
import { progressFor } from "@/lib/playback/service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return {};
  const found = await getCommunityVideo(getDb(), id);
  return found
    ? { title: found.video.title, description: found.video.description ?? `A Community Voices story from ${found.creatorName}.` }
    : {};
}

export default async function CommunityVideoPage({ params }: Params) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const db = getDb();
  const found = await getCommunityVideo(db, id);
  if (!found) notFound();
  const { video, creatorName, themes } = found;
  const sessionUser = await getSessionUser().catch(() => null);
  const decision = await accessFor(db, video, await loadViewer(db, sessionUser));
  const [source, related, progress] = await Promise.all([
    decision.allowed ? playbackSource(video, decision) : Promise.resolve(null),
    relatedCommunityVideos(db, video.id, themes.map((t) => t.id)),
    progressFor(db, sessionUser?.id ?? null, [video.id]),
  ]);
  const saved = progress.get(video.id);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <Link href="/community" className="text-sm text-muted underline">
        ← Community Voices
      </Link>
      <div className="mt-4">
        {source ? (
          <VideoPlayer
            videoId={video.id}
            src={source.src}
            customerCode={source.customerCode}
            title={video.title}
            poster={video.thumbnailUrl}
            startAt={resumeAt(saved?.positionSeconds ?? null, video.durationSeconds, saved?.completed ?? false)}
          />
        ) : (
          <PlayerUnavailable poster={video.thumbnailUrl} />
        )}
      </div>
      <h1 className="mt-6 text-3xl font-semibold">{video.title}</h1>
      <p className="mt-1 text-muted">
        {[creatorName, formatDuration(video.durationSeconds), video.viewCount ? `${video.viewCount.toLocaleString()} views` : null].filter(Boolean).join(" · ")}
      </p>
      {video.description && <p className="mt-4 whitespace-pre-line text-ink">{video.description}</p>}
      {themes.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-2">
          {themes.map((t) => (
            <li key={t.slug}>
              <Link href={`/themes/${t.slug}`} className="rounded-full border border-navy-900/15 bg-white px-3 py-1 text-sm hover:border-gold-500">
                {t.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-6">
        <ReportButton videoId={video.id} signedIn={Boolean(sessionUser)} returnTo={`/community/${video.id}`} />
      </div>

      {related.length > 0 && (
        <section className="mt-14" aria-labelledby="related">
          <h2 id="related" className="text-2xl font-semibold">
            More on these themes
          </h2>
          <ul className="mt-5 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {related.map((v) => (
              <li key={v.id}>
                <VideoCardView video={v} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
