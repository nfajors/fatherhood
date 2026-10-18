import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProgressBar } from "@/components/catalog/cards";
import { Button } from "@/components/ui/button";
import { getSessionUser } from "@/lib/auth";
import { getCourseOutline } from "@/lib/courses/catalog";
import { getDb } from "@/lib/db";
import { formatDuration } from "@/lib/format";
import { isMember, loadViewer } from "@/lib/playback/access";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const outline = await getCourseOutline(getDb(), (await params).slug, null);
  return outline ? { title: outline.course.title, description: outline.course.subtitle ?? outline.course.description ?? undefined } : {};
}

export default async function CoursePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = getDb();
  const sessionUser = await getSessionUser().catch(() => null);
  const outline = await getCourseOutline(db, slug, sessionUser?.id ?? null);
  if (!outline) notFound();
  const member = isMember(await loadViewer(db, sessionUser));
  const { course, modules, stats, themes } = outline;
  const preview = outline.flat.find((l) => l.available && l.isPreview);
  const started = stats.completedCount > 0 || outline.flat.some((l) => l.positionSeconds > 0);

  return (
    <div>
      <section className="bg-navy-950 text-white">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <Link href="/academy" className="text-sm text-white/70 underline">
            ← All courses
          </Link>
          {course.category && <p className="mt-6 text-sm font-semibold uppercase tracking-widest text-gold-400">{course.category}</p>}
          <h1 className="mt-2 max-w-3xl text-4xl font-semibold text-white sm:text-5xl">{course.title}</h1>
          {course.subtitle && <p className="mt-4 max-w-2xl text-lg text-white/75">{course.subtitle}</p>}
          <p className="mt-4 text-sm text-white/70">
            {[
              course.instructorName,
              `${stats.lessonCount} lessons`,
              formatDuration(stats.totalSeconds),
              stats.ratingAverage !== null ? `★ ${stats.ratingAverage.toFixed(1)} (${stats.ratingCount} ${stats.ratingCount === 1 ? "rating" : "ratings"})` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {course.bookChapter && (
            <p className="mt-2 text-sm text-gold-400">
              Companion to <em>Fatherhood in Focus</em>: {course.bookChapter}
            </p>
          )}
          <div className="mt-8 flex flex-wrap items-center gap-3">
            {member && outline.nextLessonId ? (
              <Button asChild size="lg">
                <Link href={`/academy/${course.slug}/${outline.nextLessonId}`}>{started ? "Continue" : "Start the course"}</Link>
              </Button>
            ) : (
              <>
                <Button asChild size="lg">
                  <Link href="/pricing">Join to watch every lesson</Link>
                </Button>
                {preview && (
                  <Button asChild size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10">
                    <Link href={`/academy/${course.slug}/${preview.id}`}>Watch a free lesson</Link>
                  </Button>
                )}
              </>
            )}
          </div>
          {member && started && (
            <div className="mt-6 max-w-sm">
              <ProgressBar percent={stats.percentComplete} label="Course progress" />
              <p className="mt-1 text-xs text-white/70">
                {stats.completedCount} of {stats.lessonCount} lessons complete
              </p>
            </div>
          )}
        </div>
      </section>

      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1fr_320px]">
        <section aria-labelledby="lessons">
          <h2 id="lessons" className="text-2xl font-semibold">
            Lessons
          </h2>
          <ol className="mt-6 space-y-8">
            {modules.map((mod, mi) => (
              <li key={mod.id}>
                <h3 className="text-sm font-semibold uppercase tracking-widest text-muted">
                  Module {mi + 1}: {mod.title}
                </h3>
                <ol className="mt-3 divide-y divide-navy-900/10 rounded-xl border border-navy-900/10 bg-white">
                  {mod.lessons.map((lesson) => {
                    const open = lesson.available && (member || lesson.isPreview);
                    const body = (
                      <div className="flex items-start gap-3 p-4">
                        <span aria-hidden className={`mt-0.5 w-5 shrink-0 text-center ${lesson.completed ? "text-gold-600" : "text-muted"}`}>
                          {lesson.completed ? "✓" : open ? "▶" : "🔒"}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-navy-900">
                            {lesson.title}
                            {lesson.isPreview && !member && <span className="ml-2 rounded bg-gold-100 px-1.5 py-0.5 text-xs text-gold-600">Free preview</span>}
                            {lesson.completed && <span className="sr-only"> (completed)</span>}
                          </p>
                          {lesson.summary && <p className="mt-1 text-sm text-muted">{lesson.summary}</p>}
                          {lesson.resources.length > 0 && (
                            <p className="mt-1 text-xs text-muted">Includes: {lesson.resources.map((r) => r.title).join(", ")}</p>
                          )}
                        </div>
                        <span className="shrink-0 text-sm text-muted">{lesson.available ? formatDuration(lesson.durationSeconds) : "Coming soon"}</span>
                      </div>
                    );
                    return (
                      <li key={lesson.id}>
                        {open ? (
                          <Link href={`/academy/${course.slug}/${lesson.id}`} className="block hover:bg-paper">
                            {body}
                          </Link>
                        ) : (
                          body
                        )}
                      </li>
                    );
                  })}
                </ol>
              </li>
            ))}
          </ol>
        </section>

        <aside className="space-y-6">
          {course.description && (
            <div>
              <h2 className="text-lg font-semibold">About this course</h2>
              <p className="mt-2 whitespace-pre-line text-ink">{course.description}</p>
            </div>
          )}
          {themes.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold">Themes</h2>
              <ul className="mt-2 flex flex-wrap gap-2">
                {themes.map((t) => (
                  <li key={t.slug}>
                    <Link href={`/themes/${t.slug}`} className="rounded-full border border-navy-900/15 bg-white px-3 py-1 text-sm hover:border-gold-500">
                      {t.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
