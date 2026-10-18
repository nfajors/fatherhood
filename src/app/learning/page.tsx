import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CourseCardView, ProgressBar } from "@/components/catalog/cards";
import { RecommendedSection } from "@/components/discovery/recommended";
import { Button } from "@/components/ui/button";
import { getSessionUser } from "@/lib/auth";
import { continueWatching, coursesInProgress } from "@/lib/courses/catalog";
import { getDb } from "@/lib/db";
import { recommendFor } from "@/lib/discovery/recommend";
import { formatDuration } from "@/lib/format";

export const metadata: Metadata = { title: "My Learning", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function LearningPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect("/sign-in?next=/learning");
  const db = getDb();
  const [watching, courses, recs] = await Promise.all([
    continueWatching(db, sessionUser.id),
    coursesInProgress(db, sessionUser.id),
    recommendFor(db, sessionUser.id, { videos: 6, courses: 3 }),
  ]);
  const empty = watching.length === 0 && courses.length === 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <h1 className="text-4xl font-semibold">My Learning</h1>

      {empty && (
        <div className="mt-8 max-w-xl">
          <p className="text-lg text-muted">Nothing in progress yet. Start a course or watch a story from another father.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild>
              <Link href="/academy">Browse courses</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/community">Community Voices</Link>
            </Button>
          </div>
        </div>
      )}

      {watching.length > 0 && (
        <section className="mt-10" aria-labelledby="continue">
          <h2 id="continue" className="text-2xl font-semibold">
            Continue watching
          </h2>
          <ul className="mt-5 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {watching.map((item) => {
              const percent = item.durationSeconds ? Math.min(100, Math.round((item.positionSeconds / item.durationSeconds) * 100)) : 0;
              return (
                <li key={item.videoId}>
                  <Link href={item.href} className="group block overflow-hidden rounded-xl border border-navy-900/10 bg-white shadow-sm hover:border-gold-500">
                    {item.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- Stream thumbnail
                      <img src={item.thumbnailUrl} alt="" className="aspect-video w-full object-cover" />
                    ) : (
                      <div className="aspect-video w-full bg-navy-100" />
                    )}
                    <ProgressBar percent={percent} label={`${item.title} progress`} />
                    <div className="p-4">
                      <p className="text-xs text-muted">{item.context}</p>
                      <p className="mt-1 font-semibold text-navy-900 group-hover:underline">{item.title}</p>
                      {item.durationSeconds ? (
                        <p className="mt-1 text-sm text-muted">{formatDuration(item.durationSeconds - item.positionSeconds)} left</p>
                      ) : null}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {courses.length > 0 && (
        <section className="mt-12" aria-labelledby="courses">
          <h2 id="courses" className="text-2xl font-semibold">
            Your courses
          </h2>
          <ul className="mt-5 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {courses.map((course) => (
              <li key={course.id}>
                <CourseCardView course={course} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-12">
        <RecommendedSection recs={recs} />
      </div>
    </div>
  );
}
