/**
 * Read side of the Professional Academy and Community Voices: published
 * courses and their outlines, lesson navigation, Community listings and the
 * viewer's own progress. Only approved videos are ever playable.
 */
import { and, asc, desc, eq, gt, inArray, sql, type SQL } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { courseModules, courses, lessonResources, lessons, themeAssignments, themes, user, videos, watchProgress } from "@/lib/db/schema";
import { percentComplete } from "@/lib/playback/progress";
import { progressFor } from "@/lib/playback/service";
import { topRatedOrder } from "@/lib/ratings/policy";

export type CourseCard = {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  coverImageUrl: string | null;
  category: string | null;
  bookChapter: string | null;
  instructorName: string | null;
  lessonCount: number;
  totalSeconds: number;
  /** Across the course's lesson videos; null until someone rates one. */
  ratingAverage: number | null;
  ratingCount: number;
  /** Null when signed out. */
  percentComplete: number | null;
};

export async function listPublishedCourses(db: Database, userId: string | null): Promise<CourseCard[]> {
  const rows = await db
    .select({
      id: courses.id,
      slug: courses.slug,
      title: courses.title,
      subtitle: courses.subtitle,
      coverImageUrl: courses.coverImageUrl,
      category: courses.category,
      bookChapter: courses.bookChapter,
      instructorName: user.name,
      lessonCount: sql<number>`count(${lessons.id}) filter (where ${videos.status} = 'approved')::int`,
      totalSeconds: sql<number>`coalesce(sum(${videos.durationSeconds}) filter (where ${videos.status} = 'approved'), 0)::int`,
      ratingCount: sql<number>`coalesce(sum(${videos.ratingCount}) filter (where ${videos.status} = 'approved'), 0)::int`,
      ratingAverage: sql<number | null>`round(sum(${videos.ratingAverage} * ${videos.ratingCount}) filter (where ${videos.status} = 'approved')
        / nullif(sum(${videos.ratingCount}) filter (where ${videos.status} = 'approved'), 0), 2)`.mapWith((v) => (v === null ? null : Number(v))),
      completed: userId
        ? sql<number>`count(${watchProgress.videoId}) filter (where ${watchProgress.completed} and ${videos.status} = 'approved')::int`
        : sql<number>`0`,
    })
    .from(courses)
    .leftJoin(user, eq(courses.instructorId, user.id))
    .leftJoin(courseModules, eq(courseModules.courseId, courses.id))
    .leftJoin(lessons, eq(lessons.moduleId, courseModules.id))
    .leftJoin(videos, eq(lessons.videoId, videos.id))
    .leftJoin(watchProgress, userId ? and(eq(watchProgress.videoId, videos.id), eq(watchProgress.userId, userId)) : sql`false`)
    .where(eq(courses.published, true))
    .groupBy(courses.id, user.name)
    .orderBy(asc(courses.sortOrder), desc(courses.publishedAt));
  return rows.map(({ completed, ...r }) => ({ ...r, percentComplete: userId ? percentComplete(completed, r.lessonCount) : null }));
}

export type OutlineLesson = {
  id: string;
  title: string;
  summary: string | null;
  isPreview: boolean;
  videoId: string | null;
  durationSeconds: number | null;
  available: boolean;
  completed: boolean;
  positionSeconds: number;
  resources: { id: string; title: string; kind: string }[];
};

export type CourseOutline = {
  course: typeof courses.$inferSelect & { instructorName: string | null };
  modules: { id: string; title: string; lessons: OutlineLesson[] }[];
  /** All lessons in order, for navigation and "continue". */
  flat: OutlineLesson[];
  themes: { slug: string; name: string }[];
  stats: {
    lessonCount: number;
    totalSeconds: number;
    completedCount: number;
    percentComplete: number;
    /** Across the lesson videos; null until someone rates one. */
    ratingAverage: number | null;
    ratingCount: number;
  };
  /** Where "Start" / "Continue" should go: the first unfinished available lesson. */
  nextLessonId: string | null;
};

export async function getCourseOutline(
  db: Database,
  slug: string,
  userId: string | null,
  options: { includeUnpublished?: boolean } = {},
): Promise<CourseOutline | null> {
  const [row] = await db
    .select({ course: courses, instructorName: user.name })
    .from(courses)
    .leftJoin(user, eq(courses.instructorId, user.id))
    .where(options.includeUnpublished ? eq(courses.slug, slug) : and(eq(courses.slug, slug), eq(courses.published, true)));
  if (!row) return null;

  const lessonRows = await db
    .select({
      moduleId: courseModules.id,
      moduleTitle: courseModules.title,
      id: lessons.id,
      title: lessons.title,
      summary: lessons.summary,
      isPreview: lessons.isPreview,
      videoId: lessons.videoId,
      durationSeconds: videos.durationSeconds,
      videoStatus: videos.status,
      ratingAverage: videos.ratingAverage,
      ratingCount: videos.ratingCount,
    })
    .from(courseModules)
    .leftJoin(lessons, eq(lessons.moduleId, courseModules.id))
    .leftJoin(videos, eq(lessons.videoId, videos.id))
    .where(eq(courseModules.courseId, row.course.id))
    .orderBy(asc(courseModules.position), asc(lessons.position));

  const lessonIds = lessonRows.flatMap((l) => (l.id ? [l.id] : []));
  const [progress, resources, courseThemes] = await Promise.all([
    progressFor(db, userId, lessonRows.flatMap((l) => (l.videoId ? [l.videoId] : []))),
    lessonIds.length
      ? db
          .select({ id: lessonResources.id, lessonId: lessonResources.lessonId, title: lessonResources.title, kind: lessonResources.kind })
          .from(lessonResources)
          .where(inArray(lessonResources.lessonId, lessonIds))
      : Promise.resolve([]),
    db
      .select({ slug: themes.slug, name: themes.name })
      .from(themeAssignments)
      .innerJoin(themes, eq(themeAssignments.themeId, themes.id))
      .where(and(eq(themeAssignments.courseId, row.course.id), eq(themeAssignments.status, "active"), eq(themes.status, "active")))
      .orderBy(desc(themeAssignments.isPrimary)),
  ]);

  const modules: CourseOutline["modules"] = [];
  for (const r of lessonRows) {
    let mod = modules.find((m) => m.id === r.moduleId);
    if (!mod) {
      mod = { id: r.moduleId, title: r.moduleTitle, lessons: [] };
      modules.push(mod);
    }
    if (!r.id) continue;
    const p = r.videoId ? progress.get(r.videoId) : undefined;
    mod.lessons.push({
      id: r.id,
      title: r.title!,
      summary: r.summary,
      isPreview: r.isPreview!,
      videoId: r.videoId,
      durationSeconds: r.durationSeconds,
      available: r.videoStatus === "approved",
      completed: p?.completed ?? false,
      positionSeconds: p?.positionSeconds ?? 0,
      resources: resources.filter((res) => res.lessonId === r.id).map((res) => ({ id: res.id, title: res.title, kind: res.kind })),
    });
  }

  const rated = lessonRows.filter((r) => r.videoStatus === "approved" && r.ratingCount);
  const ratingCount = rated.reduce((sum, r) => sum + r.ratingCount!, 0);
  const ratingSum = rated.reduce((sum, r) => sum + Number(r.ratingAverage) * r.ratingCount!, 0);
  const flat = modules.flatMap((m) => m.lessons);
  const available = flat.filter((l) => l.available);
  const completedCount = available.filter((l) => l.completed).length;
  return {
    course: { ...row.course, instructorName: row.instructorName },
    modules,
    flat,
    themes: courseThemes,
    stats: {
      lessonCount: available.length,
      totalSeconds: available.reduce((sum, l) => sum + (l.durationSeconds ?? 0), 0),
      completedCount,
      percentComplete: percentComplete(completedCount, available.length),
      ratingAverage: ratingCount ? Math.round((ratingSum / ratingCount) * 100) / 100 : null,
      ratingCount,
    },
    nextLessonId: (available.find((l) => !l.completed) ?? available[0])?.id ?? null,
  };
}

/** The lesson plus its neighbors among available lessons. */
export function lessonNavigation(outline: CourseOutline, lessonId: string) {
  const available = outline.flat.filter((l) => l.available);
  const index = available.findIndex((l) => l.id === lessonId);
  const lesson = outline.flat.find((l) => l.id === lessonId) ?? null;
  return {
    lesson,
    moduleTitle: outline.modules.find((m) => m.lessons.some((l) => l.id === lessonId))?.title ?? null,
    previous: index > 0 ? available[index - 1]! : null,
    next: index >= 0 && index < available.length - 1 ? available[index + 1]! : null,
    position: index + 1,
    count: available.length,
  };
}

// ---------------------------------------------------------------------------
// Community Voices
// ---------------------------------------------------------------------------

export type CommunityCard = {
  id: string;
  title: string;
  creatorName: string;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  publishedAt: Date | null;
  viewCount: number;
  ratingAverage: string | null;
  ratingCount: number;
};

const communityCardFields = {
  id: videos.id,
  title: videos.title,
  creatorName: user.name,
  thumbnailUrl: videos.thumbnailUrl,
  durationSeconds: videos.durationSeconds,
  publishedAt: videos.publishedAt,
  viewCount: videos.viewCount,
  ratingAverage: videos.ratingAverage,
  ratingCount: videos.ratingCount,
};

export type CommunitySort = "newest" | "top_rated" | "most_viewed";

const COMMUNITY_ORDER: Record<CommunitySort, SQL[]> = {
  newest: [sql`${videos.publishedAt} desc nulls last`, desc(videos.createdAt)],
  top_rated: [...topRatedOrder(videos.ratingAverage, videos.ratingCount), sql`${videos.publishedAt} desc nulls last`],
  most_viewed: [desc(videos.viewCount), sql`${videos.publishedAt} desc nulls last`],
};

const isPublishedCommunity = and(eq(videos.type, "community"), eq(videos.status, "approved"));

export async function listCommunityVideos(
  db: Database,
  options: { themeSlug?: string; sort?: CommunitySort; limit?: number; offset?: number } = {},
): Promise<{ videos: CommunityCard[]; total: number }> {
  const themeFilter = options.themeSlug
    ? sql`exists (select 1 from theme_assignments a join themes t on t.id = a.theme_id
        where a.video_id = ${videos.id} and a.status = 'active' and t.slug = ${options.themeSlug})`
    : undefined;
  const where = and(isPublishedCommunity, themeFilter);
  const [rows, [count]] = await Promise.all([
    db
      .select(communityCardFields)
      .from(videos)
      .innerJoin(user, eq(videos.creatorId, user.id))
      .where(where)
      .orderBy(...COMMUNITY_ORDER[options.sort ?? "newest"])
      .limit(options.limit ?? 24)
      .offset(options.offset ?? 0),
    db.select({ n: sql<number>`count(*)::int` }).from(videos).where(where),
  ]);
  return { videos: rows, total: count?.n ?? 0 };
}

/** Active themes that have at least one published Community video, for the filter. */
export async function communityThemes(db: Database) {
  return db
    .select({ slug: themes.slug, name: themes.name, count: sql<number>`count(distinct ${videos.id})::int` })
    .from(themes)
    .innerJoin(themeAssignments, and(eq(themeAssignments.themeId, themes.id), eq(themeAssignments.status, "active")))
    .innerJoin(videos, eq(themeAssignments.videoId, videos.id))
    .where(and(eq(themes.status, "active"), isPublishedCommunity))
    .groupBy(themes.id)
    .orderBy(asc(themes.sortOrder));
}

export async function getCommunityVideo(db: Database, id: string) {
  const [row] = await db
    .select({ video: videos, creatorName: user.name })
    .from(videos)
    .innerJoin(user, eq(videos.creatorId, user.id))
    .where(and(eq(videos.id, id), isPublishedCommunity));
  if (!row) return null;
  const videoThemes = await db
    .select({ id: themes.id, slug: themes.slug, name: themes.name })
    .from(themeAssignments)
    .innerJoin(themes, eq(themeAssignments.themeId, themes.id))
    .where(and(eq(themeAssignments.videoId, id), eq(themeAssignments.status, "active"), eq(themes.status, "active")))
    .orderBy(desc(themeAssignments.isPrimary));
  return { ...row, themes: videoThemes };
}

/** Other published Community videos sharing a theme, best overlap first. */
export async function relatedCommunityVideos(db: Database, videoId: string, themeIds: string[], limit = 4): Promise<CommunityCard[]> {
  if (themeIds.length === 0) return [];
  return db
    .select(communityCardFields)
    .from(videos)
    .innerJoin(user, eq(videos.creatorId, user.id))
    .innerJoin(themeAssignments, and(eq(themeAssignments.videoId, videos.id), eq(themeAssignments.status, "active")))
    .where(and(isPublishedCommunity, inArray(themeAssignments.themeId, themeIds), sql`${videos.id} <> ${videoId}`))
    .groupBy(videos.id, user.name)
    .orderBy(sql`count(*) desc`, sql`${videos.publishedAt} desc nulls last`)
    .limit(limit);
}

// ---------------------------------------------------------------------------
// My Learning
// ---------------------------------------------------------------------------

export type ContinueItem = {
  videoId: string;
  title: string;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  positionSeconds: number;
  href: string;
  context: string;
};

/** Videos the viewer started and hasn't finished, most recent first. */
export async function continueWatching(db: Database, userId: string, limit = 6): Promise<ContinueItem[]> {
  const rows = await db
    .select({
      videoId: videos.id,
      title: videos.title,
      type: videos.type,
      thumbnailUrl: videos.thumbnailUrl,
      durationSeconds: videos.durationSeconds,
      positionSeconds: watchProgress.positionSeconds,
      lessonId: lessons.id,
      lessonTitle: lessons.title,
      courseSlug: courses.slug,
      courseTitle: courses.title,
    })
    .from(watchProgress)
    .innerJoin(videos, eq(watchProgress.videoId, videos.id))
    .leftJoin(lessons, eq(lessons.videoId, videos.id))
    .leftJoin(courseModules, eq(lessons.moduleId, courseModules.id))
    .leftJoin(courses, and(eq(courseModules.courseId, courses.id), eq(courses.published, true)))
    .where(and(eq(watchProgress.userId, userId), eq(watchProgress.completed, false), gt(watchProgress.positionSeconds, 0), eq(videos.status, "approved")))
    .orderBy(desc(watchProgress.updatedAt))
    .limit(limit * 2);

  const seen = new Set<string>();
  const items: ContinueItem[] = [];
  for (const r of rows) {
    if (seen.has(r.videoId)) continue;
    if (r.type === "professional" && !r.courseSlug) continue; // lesson of an unpublished course
    seen.add(r.videoId);
    items.push({
      videoId: r.videoId,
      title: r.lessonTitle ?? r.title,
      thumbnailUrl: r.thumbnailUrl,
      durationSeconds: r.durationSeconds,
      positionSeconds: r.positionSeconds,
      href: r.courseSlug ? `/academy/${r.courseSlug}/${r.lessonId}` : `/community/${r.videoId}`,
      context: r.courseTitle ?? "Community Voices",
    });
  }
  return items.slice(0, limit);
}

/** Courses with any progress, least finished first. */
export async function coursesInProgress(db: Database, userId: string): Promise<CourseCard[]> {
  const started = await db
    .selectDistinct({ courseId: courseModules.courseId })
    .from(watchProgress)
    .innerJoin(lessons, eq(lessons.videoId, watchProgress.videoId))
    .innerJoin(courseModules, eq(lessons.moduleId, courseModules.id))
    .where(eq(watchProgress.userId, userId));
  const ids = new Set(started.map((s) => s.courseId));
  return (await listPublishedCourses(db, userId))
    .filter((c) => ids.has(c.id))
    .sort((a, b) => (a.percentComplete ?? 0) - (b.percentComplete ?? 0));
}
