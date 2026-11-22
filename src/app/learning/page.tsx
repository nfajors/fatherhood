import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CourseCardView, ProgressBar } from "@/components/catalog/cards";
import { RecommendedSection } from "@/components/discovery/recommended";
import { Button } from "@/components/ui/button";
import { PathSteps } from "@/components/coach/path-card";
import { Card } from "@/components/ui/card";
import { getSessionUser } from "@/lib/auth";
import { canUseCoach, coachConfigured } from "@/lib/coach/access";
import { getPath } from "@/lib/coach/path";
import { currentRegion } from "@/lib/region-server";
import { formatDate } from "@/lib/regions";
import { continueWatching, coursesInProgress } from "@/lib/courses/catalog";
import { getDb } from "@/lib/db";
import { recommendFor } from "@/lib/discovery/recommend";
import { formatDuration } from "@/lib/format";
import { certificatesFor } from "@/lib/learning/certificates";

export const metadata: Metadata = { title: "My Learning", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function LearningPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect("/sign-in?next=/learning");
  const db = getDb();
  const region = await currentRegion();
  const [watching, courses, recs, certificates, coach] = await Promise.all([
    continueWatching(db, sessionUser.id),
    coursesInProgress(db, sessionUser.id),
    recommendFor(db, sessionUser.id, { videos: 6, courses: 3 }),
    certificatesFor(db, sessionUser.id),
    (async () => (coachConfigured() && (await canUseCoach(db, sessionUser)) ? { path: await getPath(db, sessionUser.id) } : null))(),
  ]);
  const empty = watching.length === 0 && courses.length === 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <h1 className="text-4xl font-semibold">My Learning</h1>

      {coach && (
        <Card className="mt-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <h2 className="text-2xl font-semibold">Your path</h2>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm">
                <Link href="/coach">Talk to your coach</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href="/coach/plan">{coach.path ? "Update your plan" : "Get a plan"}</Link>
              </Button>
            </div>
          </div>
          <div className="mt-3">
            {coach.path ? (
              <PathSteps path={coach.path} compact />
            ) : (
              <p className="max-w-2xl text-muted">Tell the coach where you are and what you want to work on, and it plans a path of lessons and stories for you.</p>
            )}
          </div>
        </Card>
      )}

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

      {certificates.length > 0 && (
        <section className="mt-12" aria-labelledby="certificates">
          <h2 id="certificates" className="text-2xl font-semibold">
            Your certificates
          </h2>
          <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {certificates.map((c) => (
              <li key={c.code}>
                <Link href={`/certificates/${c.code}`} className="group flex items-start gap-3 rounded-xl border border-gold-500/40 bg-gold-100 p-4 hover:border-gold-500">
                  <span aria-hidden className="text-2xl">
                    🎓
                  </span>
                  <span className="min-w-0">
                    <span className="block font-semibold text-navy-900 group-hover:underline">{c.courseTitle}</span>
                    <span className="text-sm text-muted">
                      Completed {formatDate(c.issuedAt, region.locale)}
                    </span>
                  </span>
                </Link>
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
