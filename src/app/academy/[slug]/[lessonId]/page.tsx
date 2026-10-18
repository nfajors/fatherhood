import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { CommentsSection } from "@/components/comments/comments-section";
import { RatingsSection } from "@/components/ratings/ratings-section";
import { LessonQuiz } from "@/components/learning/lesson-quiz";
import { KIND_LABEL } from "@/lib/courses/resources";
import { LessonPlayer } from "@/components/video/lesson-player";
import { PlayerUnavailable } from "@/components/video/video-player";
import { ReportButton } from "@/components/video/report-button";
import { getSessionUser } from "@/lib/auth";
import { getCourseOutline, lessonNavigation } from "@/lib/courses/catalog";
import { getDb } from "@/lib/db";
import { formatBytes, formatDuration } from "@/lib/format";
import { quizForLearner } from "@/lib/learning/quizzes";
import { accessFor, loadViewer, playbackSource } from "@/lib/playback/access";
import { resumeAt } from "@/lib/playback/progress";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; lessonId: string }> };
type Search = { searchParams: Promise<{ reviews?: string; all?: string; comments?: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug, lessonId } = await params;
  const outline = await getCourseOutline(getDb(), slug, null);
  const lesson = outline?.flat.find((l) => l.id === lessonId);
  return lesson && outline ? { title: `${lesson.title} | ${outline.course.title}` } : {};
}

export default async function LessonPage({ params, searchParams }: Params & Search) {
  const [{ slug, lessonId }, { reviews, all, comments }] = await Promise.all([params, searchParams]);
  if (!z.uuid().safeParse(lessonId).success) notFound();
  const db = getDb();
  const sessionUser = await getSessionUser().catch(() => null);
  const outline = await getCourseOutline(db, slug, sessionUser?.id ?? null);
  if (!outline) notFound();
  const nav = lessonNavigation(outline, lessonId);
  if (!nav.lesson || !nav.lesson.available || !nav.lesson.videoId) notFound();
  const lesson = nav.lesson;

  const video = await db.query.videos.findFirst({ where: (v, { eq }) => eq(v.id, lesson.videoId!) });
  if (!video) notFound();
  const decision = await accessFor(db, video, await loadViewer(db, sessionUser));
  const source = decision.allowed ? await playbackSource(video, decision) : null;
  const returnTo = `/academy/${slug}/${lessonId}`;
  const quiz = decision.allowed ? await quizForLearner(db, lessonId, sessionUser?.id ?? null) : null;

  return (
    <div className="mx-auto grid max-w-6xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[1fr_320px]">
      <div className="min-w-0">
        <Link href={`/academy/${slug}`} className="text-sm text-muted underline">
          ← {outline.course.title}
        </Link>
        <div className="mt-4">
          {!decision.allowed ? (
            <div className="flex aspect-video flex-col items-center justify-center rounded-xl bg-navy-950 p-6 text-center text-white">
              <p className="font-serif text-2xl">This lesson is for members</p>
              <p className="mt-2 max-w-md text-white/75">Join to watch every lesson in every course, with new courses each month.</p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <Button asChild>
                  <Link href="/pricing">See membership</Link>
                </Button>
                {decision.reason === "sign_in_required" && (
                  <Button asChild variant="outline" className="border-white/30 text-white hover:bg-white/10">
                    <Link href={`/sign-in?next=${encodeURIComponent(returnTo)}`}>Sign in</Link>
                  </Button>
                )}
              </div>
            </div>
          ) : source ? (
            <LessonPlayer
              videoId={video.id}
              src={source.src}
              customerCode={source.customerCode}
              title={lesson.title}
              poster={video.thumbnailUrl}
              startAt={resumeAt(lesson.positionSeconds, video.durationSeconds, lesson.completed)}
              initialCompleted={lesson.completed}
              canTrack={Boolean(sessionUser)}
              next={nav.next ? { href: `/academy/${slug}/${nav.next.id}`, title: nav.next.title } : null}
            />
          ) : (
            <PlayerUnavailable poster={video.thumbnailUrl} />
          )}
        </div>
        <p className="mt-6 text-sm text-muted">
          {nav.moduleTitle} · Lesson {nav.position} of {nav.count}
          {video.durationSeconds ? ` · ${formatDuration(video.durationSeconds)}` : ""}
        </p>
        <h1 className="mt-1 text-3xl font-semibold">{lesson.title}</h1>
        {lesson.summary && <p className="mt-3 text-lg text-ink">{lesson.summary}</p>}
        {lesson.resources.length > 0 && (
          <section aria-labelledby="materials" className="mt-6">
            <h2 id="materials" className="text-lg font-semibold">
              Lesson materials
            </h2>
            <ul className="mt-3 divide-y divide-navy-900/10 rounded-xl border border-navy-900/10 bg-white">
              {lesson.resources.map((r) => {
                const meta = `${KIND_LABEL[r.kind as keyof typeof KIND_LABEL] ?? "Download"} · ${r.fileName.split(".").pop()?.toUpperCase()} · ${formatBytes(r.sizeBytes)}`;
                return (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <span className="min-w-0">
                      <span className="block font-medium">{r.title}</span>
                      <span className="text-xs text-muted">{meta}</span>
                    </span>
                    {decision.allowed ? (
                      <a
                        href={`/api/resources/${r.id}/download`}
                        className="inline-flex h-9 items-center gap-2 rounded-md border border-navy-900/20 px-3 text-sm font-semibold text-navy-900 hover:bg-navy-100"
                      >
                        <span aria-hidden>↓</span> Download<span className="sr-only"> {r.title}</span>
                      </a>
                    ) : (
                      <span className="text-sm text-muted">
                        <span aria-hidden>🔒 </span>For members
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        {quiz && <LessonQuiz quiz={quiz} signInHref={sessionUser ? null : `/sign-in?next=${encodeURIComponent(returnTo)}`} />}
        <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-navy-900/10 pt-6">
          {nav.previous ? (
            <Link href={`/academy/${slug}/${nav.previous.id}`} className="text-sm text-navy-900 underline underline-offset-4">
              ← {nav.previous.title}
            </Link>
          ) : (
            <span />
          )}
          {decision.allowed && <ReportButton videoId={video.id} signedIn={Boolean(sessionUser)} returnTo={returnTo} />}
        </div>
        <RatingsSection db={db} videoId={video.id} viewer={sessionUser} sort={reviews === "newest" ? "newest" : "helpful"} showAll={all === "1"} path={returnTo} />
        {decision.allowed && <CommentsSection db={db} videoId={video.id} viewer={sessionUser} path={returnTo} showAll={comments === "all"} />}
      </div>

      <aside aria-label="Course outline" className="lg:sticky lg:top-6 lg:self-start">
        <div className="rounded-xl border border-navy-900/10 bg-white">
          <p className="border-b border-navy-900/10 p-4 font-semibold">{outline.course.title}</p>
          <ol className="max-h-[70vh] overflow-y-auto py-2 text-sm">
            {outline.modules.map((mod) => (
              <li key={mod.id}>
                <p className="px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-widest text-muted">{mod.title}</p>
                <ol>
                  {mod.lessons
                    .filter((l) => l.available)
                    .map((l) => (
                      <li key={l.id}>
                        <Link
                          href={`/academy/${slug}/${l.id}`}
                          aria-current={l.id === lessonId ? "page" : undefined}
                          className={`flex gap-2 px-4 py-2 hover:bg-paper ${l.id === lessonId ? "bg-gold-100 font-semibold" : ""}`}
                        >
                          <span aria-hidden className="w-4 shrink-0 text-gold-600">
                            {l.completed ? "✓" : ""}
                          </span>
                          <span className="min-w-0 flex-1">{l.title}</span>
                        </Link>
                      </li>
                    ))}
                </ol>
              </li>
            ))}
          </ol>
        </div>
      </aside>
    </div>
  );
}
