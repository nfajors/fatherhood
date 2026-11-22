/**
 * What the coach can look up: the published library (courses, lessons in
 * published courses, approved Community videos). Members can watch all of it,
 * and the coach is for members only, so nothing here is behind a paywall for them.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { courseModules, courses, lessons, user, videos } from "@/lib/db/schema";
import { formatDuration } from "@/lib/format";
import { MARK_END, MARK_START, search } from "@/lib/search/search";
import { COACH_POLICY } from "./policy";

export type LibraryKind = "course" | "lesson" | "community";

export type LibraryHit = {
  kind: LibraryKind;
  id: string;
  title: string;
  /** Site path to link, e.g. /academy/presence/{lessonId}. */
  path: string;
  /** Course title for a lesson, creator for a Community video. */
  context: string | null;
  length: string | null;
  excerpt: string | null;
};

const stripMarks = (text: string | null) => (text ? text.split(MARK_START).join("").split(MARK_END).join("").trim() || null : null);

/** Words joined with "or", so a natural-language query finds anything relevant, ranked by relevance. */
export function libraryQuery(raw: string): string {
  const words = (raw.toLowerCase().match(/[\p{L}\p{N}'-]+/gu) ?? []).filter((w) => w.length > 2 && w !== "and" && w !== "the" && w !== "or");
  return [...new Set(words)].slice(0, 12).join(" or ");
}

export async function searchLibrary(db: Database, rawQuery: string): Promise<LibraryHit[]> {
  const query = libraryQuery(rawQuery);
  if (!query) return [];
  const found = await search(db, query, { type: "all", sort: "relevance" });
  const hits: LibraryHit[] = [
    ...found.lessons.items.map((l) => ({
      kind: "lesson" as const,
      id: l.id,
      title: l.title,
      path: `/academy/${l.courseSlug}/${l.id}`,
      context: `Lesson in the course "${l.courseTitle}"`,
      length: formatDuration(l.durationSeconds) || null,
      excerpt: stripMarks(l.snippet),
    })),
    ...found.community.items.map((v) => ({
      kind: "community" as const,
      id: v.id,
      title: v.title,
      path: `/community/${v.id}`,
      context: `Community Voices story by ${v.creatorName}`,
      length: formatDuration(v.durationSeconds) || null,
      excerpt: stripMarks(v.snippet),
    })),
    ...found.courses.items.map((c) => ({
      kind: "course" as const,
      id: c.id,
      title: c.title,
      path: `/academy/${c.slug}`,
      context: `Course, ${c.lessonCount} ${c.lessonCount === 1 ? "lesson" : "lessons"}`,
      length: formatDuration(c.totalSeconds) || null,
      excerpt: c.subtitle,
    })),
  ];
  return hits.slice(0, COACH_POLICY.searchResults);
}

const clip = (text: string | null, max: number) => (text && text.length > max ? `${text.slice(0, max)} [transcript continues]` : text);

/** One item in full enough to coach from: its description or summary and transcript. Null if it isn't published. */
export async function readLibraryItem(db: Database, kind: LibraryKind, id: string) {
  if (kind === "lesson") {
    const [row] = await db
      .select({
        title: lessons.title,
        summary: lessons.summary,
        courseTitle: courses.title,
        courseSlug: courses.slug,
        description: videos.description,
        transcript: videos.transcript,
        durationSeconds: videos.durationSeconds,
      })
      .from(lessons)
      .innerJoin(courseModules, eq(courseModules.id, lessons.moduleId))
      .innerJoin(courses, eq(courses.id, courseModules.courseId))
      .innerJoin(videos, eq(videos.id, lessons.videoId))
      .where(and(eq(lessons.id, id), eq(courses.published, true), eq(videos.status, "approved")));
    if (!row) return null;
    return {
      kind,
      title: row.title,
      path: `/academy/${row.courseSlug}/${id}`,
      course: row.courseTitle,
      length: formatDuration(row.durationSeconds) || null,
      summary: row.summary ?? row.description,
      transcript: clip(row.transcript, COACH_POLICY.maxTranscriptChars),
    };
  }
  if (kind === "community") {
    const [row] = await db
      .select({ title: videos.title, description: videos.description, transcript: videos.transcript, creator: user.name, durationSeconds: videos.durationSeconds })
      .from(videos)
      .innerJoin(user, eq(user.id, videos.creatorId))
      .where(and(eq(videos.id, id), eq(videos.type, "community"), eq(videos.status, "approved")));
    if (!row) return null;
    return {
      kind,
      title: row.title,
      path: `/community/${id}`,
      creator: row.creator,
      length: formatDuration(row.durationSeconds) || null,
      summary: row.description,
      transcript: clip(row.transcript, COACH_POLICY.maxTranscriptChars),
    };
  }
  const course = await db.query.courses.findFirst({ where: and(eq(courses.id, id), eq(courses.published, true)) });
  if (!course) return null;
  const outline = await db
    .select({ id: lessons.id, title: lessons.title, summary: lessons.summary })
    .from(lessons)
    .innerJoin(courseModules, eq(courseModules.id, lessons.moduleId))
    .innerJoin(videos, eq(videos.id, lessons.videoId))
    .where(and(eq(courseModules.courseId, id), eq(videos.status, "approved")))
    .orderBy(asc(courseModules.position), asc(lessons.position));
  return {
    kind,
    title: course.title,
    path: `/academy/${course.slug}`,
    subtitle: course.subtitle,
    summary: course.description,
    bookChapter: course.bookChapter,
    lessons: outline.map((l) => ({ id: l.id, title: l.title, path: `/academy/${course.slug}/${l.id}`, summary: l.summary })),
  };
}

export type PathCandidate = { ref: string; kind: LibraryKind; id: string; title: string; path: string; about: string | null; themes: string[] };

/**
 * Everything a learning path can include: published courses and their lessons, and
 * the best-liked Community videos. Each has a short ref ("L12") the planner cites.
 */
export async function pathCatalog(db: Database, communityLimit = 60): Promise<PathCandidate[]> {
  const themeNames = (kind: "video" | "course") =>
    sql<string[]>`coalesce((select array_agg(t.name order by a.is_primary desc, a.confidence desc nulls last) from theme_assignments a join themes t on t.id = a.theme_id
      where a.${sql.raw(kind === "video" ? "video_id" : "course_id")} = ${sql.raw(kind === "video" ? `"videos"."id"` : `"courses"."id"`)} and a.status = 'active' and t.status = 'active'), '{}')`;
  const [courseRows, lessonRows, communityRows] = await Promise.all([
    db
      .select({ id: courses.id, slug: courses.slug, title: courses.title, about: courses.subtitle, themes: themeNames("course") })
      .from(courses)
      .where(eq(courses.published, true))
      .orderBy(asc(courses.sortOrder)),
    db
      .select({ id: lessons.id, title: lessons.title, summary: lessons.summary, slug: courses.slug, courseTitle: courses.title, themes: themeNames("video") })
      .from(lessons)
      .innerJoin(courseModules, eq(courseModules.id, lessons.moduleId))
      .innerJoin(courses, eq(courses.id, courseModules.courseId))
      .innerJoin(videos, eq(videos.id, lessons.videoId))
      .where(and(eq(courses.published, true), eq(videos.status, "approved")))
      .orderBy(asc(courses.sortOrder), asc(courseModules.position), asc(lessons.position)),
    db
      .select({ id: videos.id, title: videos.title, about: videos.description, themes: themeNames("video") })
      .from(videos)
      .where(and(eq(videos.type, "community"), eq(videos.status, "approved")))
      .orderBy(sql`${videos.ratingCount} * coalesce(${videos.ratingAverage}, 3) + ${videos.viewCount} / 10.0 desc`)
      .limit(communityLimit),
  ]);
  return [
    ...courseRows.map((c, i) => ({ ref: `C${i + 1}`, kind: "course" as const, id: c.id, title: c.title, path: `/academy/${c.slug}`, about: c.about, themes: c.themes })),
    ...lessonRows.map((l, i) => ({
      ref: `L${i + 1}`,
      kind: "lesson" as const,
      id: l.id,
      title: l.title,
      path: `/academy/${l.slug}/${l.id}`,
      about: [`In "${l.courseTitle}"`, l.summary].filter(Boolean).join(". "),
      themes: l.themes,
    })),
    ...communityRows.map((v, i) => ({
      ref: `V${i + 1}`,
      kind: "community" as const,
      id: v.id,
      title: v.title,
      path: `/community/${v.id}`,
      about: v.about ? v.about.slice(0, 200) : null,
      themes: v.themes,
    })),
  ];
}
