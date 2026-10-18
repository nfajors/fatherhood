/** Loads what a sequence email can say about one person (see EmailContext). */
import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { certificates, courseModules, courses, lessons, subscriptions, user, videos, watchProgress } from "@/lib/db/schema";
import { publishedCollections } from "@/lib/collections/service";
import { continueWatching, listPublishedCourses } from "@/lib/courses/catalog";
import { recommendFor } from "@/lib/discovery/recommend";
import { hasActiveMembership } from "@/lib/entitlements";
import { formatDuration } from "@/lib/format";
import { reviewerName } from "@/lib/ratings/service";
import type { EmailContext } from "./sequences";

/** Site-wide parts, loaded once per run. */
export type SharedContext = Pick<EmailContext, "startHere" | "freeLesson"> & { publishedAt: Map<string, Date | null> };

export async function loadSharedContext(db: Database): Promise<SharedContext> {
  const [featured, preview, published] = await Promise.all([
    publishedCollections(db, { featuredOnly: true, preview: 1 }),
    db
      .select({ lessonId: lessons.id, title: lessons.title, courseTitle: courses.title, slug: courses.slug })
      .from(lessons)
      .innerJoin(courseModules, eq(lessons.moduleId, courseModules.id))
      .innerJoin(courses, eq(courseModules.courseId, courses.id))
      .innerJoin(videos, eq(lessons.videoId, videos.id))
      .where(and(eq(lessons.isPreview, true), eq(courses.published, true), eq(videos.status, "approved")))
      .orderBy(desc(courses.publishedAt), asc(courseModules.position), asc(lessons.position))
      .limit(1),
    db.select({ id: courses.id, publishedAt: courses.publishedAt }).from(courses).where(eq(courses.published, true)),
  ]);
  const start = featured[0]?.collection;
  const free = preview[0];
  return {
    startHere: start ? { title: start.title, href: `/collections/${start.slug}` } : null,
    freeLesson: free ? { title: free.title, courseTitle: free.courseTitle, href: `/academy/${free.slug}/${free.lessonId}` } : null,
    publishedAt: new Map(published.map((c) => [c.id, c.publishedAt])),
  };
}

/** Everything about one person, or null if the account is gone. */
export async function loadEmailContext(db: Database, userId: string, shared: SharedContext, now: Date = new Date()): Promise<(EmailContext & { email: string }) | null> {
  const [person] = await db.select({ name: user.name, email: user.email }).from(user).where(eq(user.id, userId));
  if (!person) return null;

  const [subs, activity, lessonsDone, certs, resume, courseCards, recs] = await Promise.all([
    db.select({ status: subscriptions.status, currentPeriodEnd: subscriptions.currentPeriodEnd }).from(subscriptions).where(eq(subscriptions.userId, userId)),
    lastActivity(db, userId),
    db
      .select({ n: count() })
      .from(watchProgress)
      .where(and(eq(watchProgress.userId, userId), eq(watchProgress.completed, true), inArray(watchProgress.videoId, db.select({ id: lessons.videoId }).from(lessons)))),
    db.select({ n: count() }).from(certificates).where(and(eq(certificates.userId, userId), isNull(certificates.revokedAt))),
    continueWatching(db, userId, 1),
    listPublishedCourses(db, userId),
    recommendFor(db, userId, { videos: 3, courses: 0 }),
  ]);

  const member = hasActiveMembership(subs, now);
  const lastEnd = subs.length ? new Date(Math.max(...subs.map((s) => s.currentPeriodEnd.getTime()))) : null;
  const firstName = person.name.trim().split(/\s+/)[0] || "there";

  return {
    email: person.email,
    firstName,
    member,
    membershipEndedAt: !member && lastEnd && lastEnd <= now ? lastEnd : null,
    lastActiveAt: activity,
    continueItem: resume[0] ? { title: resume[0].title, href: resume[0].href, context: resume[0].context } : null,
    lessonsCompleted: lessonsDone[0]?.n ?? 0,
    certificates: certs[0]?.n ?? 0,
    startHere: shared.startHere,
    freeLesson: shared.freeLesson,
    // Newest first, leaving out courses they've finished.
    courses: courseCards
      .filter((c) => c.lessonCount > 0 && (c.percentComplete ?? 0) < 100)
      .map((c) => ({
        title: c.title,
        href: `/academy/${c.slug}`,
        meta: [c.instructorName, `${c.lessonCount} ${c.lessonCount === 1 ? "lesson" : "lessons"}`, formatDuration(c.totalSeconds)].filter(Boolean).join(" · "),
        note: c.subtitle,
        publishedAt: shared.publishedAt.get(c.id) ?? null,
      }))
      .sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0)),
    stories: recs.videos.map((v) => ({
      title: v.title,
      href: `/community/${v.id}`,
      meta: [reviewerName(v.creatorName), formatDuration(v.durationSeconds)].filter(Boolean).join(" · "),
    })),
  };
}

/** The last time this person watched anything. */
export async function lastActivity(db: Database, userId: string): Promise<Date | null> {
  const [row] = await db.execute<{ at: string | null }>(sql`
    select greatest(
      (select max(updated_at) from watch_progress where user_id = ${userId}),
      (select max(last_heartbeat_at) from watch_sessions where user_id = ${userId})
    ) as at
  `);
  return row?.at ? new Date(row.at) : null;
}
