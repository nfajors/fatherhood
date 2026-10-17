/**
 * Course building for admins: course details, modules and lessons, ordering,
 * and publishing. Lessons point at approved professional videos.
 */
import { and, asc, desc, eq, gt, lt, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { courseModules, courses, lessons, user, videos } from "@/lib/db/schema";
import { slugify } from "@/lib/slug";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export class CourseError extends Error {
  constructor(
    readonly reason: "not_found" | "slug_taken" | "invalid_slug" | "not_publishable" | "invalid_video",
    message: string,
  ) {
    super(message);
    this.name = "CourseError";
  }
}

export type CourseDetails = {
  title: string;
  slug?: string;
  subtitle?: string | null;
  description?: string | null;
  category?: string | null;
  coverImageUrl?: string | null;
  bookChapter?: string | null;
  instructorId?: string | null;
  sortOrder?: number;
};

export async function createCourse(db: Database, details: CourseDetails) {
  const slug = slugify(details.slug || details.title);
  if (!slug) throw new CourseError("invalid_slug", "The course needs a title with letters or numbers.");
  const [row] = await db
    .insert(courses)
    .values({ ...details, title: details.title.trim(), slug, published: false })
    .onConflictDoNothing({ target: courses.slug })
    .returning();
  if (!row) throw new CourseError("slug_taken", `A course already uses the address /academy/${slug}.`);
  return row;
}

export async function updateCourse(db: Database, id: string, details: Partial<CourseDetails>) {
  const changes: Partial<typeof courses.$inferInsert> = { ...details };
  if (details.slug !== undefined) {
    const slug = slugify(details.slug);
    if (!slug) throw new CourseError("invalid_slug", "The address needs letters or numbers.");
    const [taken] = await db.select({ id: courses.id }).from(courses).where(and(eq(courses.slug, slug), sql`${courses.id} <> ${id}`));
    if (taken) throw new CourseError("slug_taken", `A course already uses the address /academy/${slug}.`);
    changes.slug = slug;
  }
  if (details.title !== undefined) changes.title = details.title.trim();
  const [row] = await db.update(courses).set(changes).where(eq(courses.id, id)).returning();
  if (!row) throw new CourseError("not_found", "Course not found.");
  return row;
}

/**
 * Publish only a course with at least one lesson, every lesson attached to an
 * approved professional video, so members never meet a dead end.
 */
export async function setPublished(db: Database, id: string, published: boolean, now: Date = new Date()) {
  if (published) {
    const rows = await db
      .select({ lessonTitle: lessons.title, videoStatus: videos.status, videoType: videos.type })
      .from(lessons)
      .innerJoin(courseModules, eq(lessons.moduleId, courseModules.id))
      .leftJoin(videos, eq(lessons.videoId, videos.id))
      .where(eq(courseModules.courseId, id));
    if (rows.length === 0) throw new CourseError("not_publishable", "Add at least one lesson before publishing.");
    const unready = rows.filter((r) => r.videoStatus !== "approved" || r.videoType !== "professional").map((r) => r.lessonTitle);
    if (unready.length) {
      throw new CourseError("not_publishable", `These lessons need an approved professional video first: ${unready.join(", ")}.`);
    }
  }
  const [row] = await db
    .update(courses)
    .set({ published, publishedAt: published ? sql`coalesce(${courses.publishedAt}, ${now.toISOString()}::timestamptz)` : undefined })
    .where(eq(courses.id, id))
    .returning();
  if (!row) throw new CourseError("not_found", "Course not found.");
  return row;
}

// ---------------------------------------------------------------------------
// Modules and lessons
// ---------------------------------------------------------------------------

export async function addModule(db: Database, courseId: string, title: string) {
  return db.transaction(async (tx) => {
    const [course] = await tx.select({ id: courses.id }).from(courses).where(eq(courses.id, courseId)).for("update");
    if (!course) throw new CourseError("not_found", "Course not found.");
    const [{ next } = { next: 1 }] = await tx
      .select({ next: sql<number>`coalesce(max(${courseModules.position}), 0)::int + 1` })
      .from(courseModules)
      .where(eq(courseModules.courseId, courseId));
    const [row] = await tx.insert(courseModules).values({ courseId, title: title.trim(), position: next }).returning();
    return row!;
  });
}

export async function renameModule(db: Database, moduleId: string, title: string) {
  const [row] = await db.update(courseModules).set({ title: title.trim() }).where(eq(courseModules.id, moduleId)).returning();
  if (!row) throw new CourseError("not_found", "Module not found.");
  return row;
}

/** Deletes the module and its lessons (not the videos). */
export async function deleteModule(db: Database, moduleId: string) {
  const [row] = await db.delete(courseModules).where(eq(courseModules.id, moduleId)).returning({ id: courseModules.id });
  if (!row) throw new CourseError("not_found", "Module not found.");
}

async function assertLessonVideo(tx: Transaction, videoId: string | null | undefined) {
  if (!videoId) return;
  const [video] = await tx.select({ type: videos.type, status: videos.status }).from(videos).where(eq(videos.id, videoId));
  if (!video || video.type !== "professional") throw new CourseError("invalid_video", "Lessons use professional videos.");
}

export type LessonDetails = { title: string; summary?: string | null; videoId?: string | null; isPreview?: boolean };

export async function addLesson(db: Database, moduleId: string, details: LessonDetails) {
  return db.transaction(async (tx) => {
    const [mod] = await tx.select({ id: courseModules.id }).from(courseModules).where(eq(courseModules.id, moduleId)).for("update");
    if (!mod) throw new CourseError("not_found", "Module not found.");
    await assertLessonVideo(tx, details.videoId);
    const [{ next } = { next: 1 }] = await tx
      .select({ next: sql<number>`coalesce(max(${lessons.position}), 0)::int + 1` })
      .from(lessons)
      .where(eq(lessons.moduleId, moduleId));
    const [row] = await tx
      .insert(lessons)
      .values({ moduleId, title: details.title.trim(), summary: details.summary ?? null, videoId: details.videoId ?? null, isPreview: details.isPreview ?? false, position: next })
      .returning();
    return row!;
  });
}

export async function updateLesson(db: Database, lessonId: string, details: Partial<LessonDetails>) {
  return db.transaction(async (tx) => {
    await assertLessonVideo(tx, details.videoId);
    const [row] = await tx
      .update(lessons)
      .set({ ...details, ...(details.title !== undefined ? { title: details.title.trim() } : {}) })
      .where(eq(lessons.id, lessonId))
      .returning();
    if (!row) throw new CourseError("not_found", "Lesson not found.");
    return row;
  });
}

export async function deleteLesson(db: Database, lessonId: string) {
  const [row] = await db.delete(lessons).where(eq(lessons.id, lessonId)).returning({ id: lessons.id });
  if (!row) throw new CourseError("not_found", "Lesson not found.");
}

/**
 * Swap a row with its neighbor above or below. Positions are unique, so the
 * swap parks the moving row at -1 first.
 */
async function swapPosition(
  db: Database,
  table: typeof courseModules | typeof lessons,
  scope: { column: typeof courseModules.courseId | typeof lessons.moduleId; value: string },
  id: string,
  position: number,
  direction: "up" | "down",
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [neighbor] = await tx
      .select({ id: table.id, position: table.position })
      .from(table)
      .where(and(eq(scope.column, scope.value), direction === "up" ? lt(table.position, position) : gt(table.position, position)))
      .orderBy(direction === "up" ? desc(table.position) : asc(table.position))
      .limit(1);
    if (!neighbor) return false;
    await tx.update(table).set({ position: -1 }).where(eq(table.id, id));
    await tx.update(table).set({ position }).where(eq(table.id, neighbor.id));
    await tx.update(table).set({ position: neighbor.position }).where(eq(table.id, id));
    return true;
  });
}

export async function moveModule(db: Database, moduleId: string, direction: "up" | "down") {
  const [mod] = await db.select().from(courseModules).where(eq(courseModules.id, moduleId));
  if (!mod) throw new CourseError("not_found", "Module not found.");
  return swapPosition(db, courseModules, { column: courseModules.courseId, value: mod.courseId }, mod.id, mod.position, direction);
}

export async function moveLesson(db: Database, lessonId: string, direction: "up" | "down") {
  const [lesson] = await db.select().from(lessons).where(eq(lessons.id, lessonId));
  if (!lesson) throw new CourseError("not_found", "Lesson not found.");
  return swapPosition(db, lessons, { column: lessons.moduleId, value: lesson.moduleId }, lesson.id, lesson.position, direction);
}

// ---------------------------------------------------------------------------
// Admin views
// ---------------------------------------------------------------------------

export async function listAllCourses(db: Database) {
  return db
    .select({
      id: courses.id,
      slug: courses.slug,
      title: courses.title,
      published: courses.published,
      lessonCount: sql<number>`(select count(*)::int from lessons l join course_modules m on m.id = l.module_id where m.course_id = "courses"."id")`,
    })
    .from(courses)
    .orderBy(asc(courses.sortOrder), asc(courses.title));
}

/** Approved professional videos, for attaching to lessons. */
export async function lessonVideoOptions(db: Database) {
  return db
    .select({ id: videos.id, title: videos.title, durationSeconds: videos.durationSeconds })
    .from(videos)
    .where(and(eq(videos.type, "professional"), eq(videos.status, "approved")))
    .orderBy(desc(videos.publishedAt));
}

/** People who can be named as a course's instructor. */
export async function instructorOptions(db: Database) {
  return db
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(sql`${user.role} in ('creator', 'admin')`)
    .orderBy(asc(user.name));
}
