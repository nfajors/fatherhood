/**
 * Course certificates: earned by finishing every available lesson of a
 * published course and passing every published quiz in it. Issued once per
 * person and course, verifiable by anyone at /certificates/{code}.
 */
import { randomBytes } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { certificates, courseModules, courses, lessons, user } from "@/lib/db/schema";

/** Unambiguous characters (no 0/O, 1/I/L). */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** "FS-7K3M-9QPX": short enough to read aloud, 31^8 possibilities. */
export function certificateCode(bytes: Buffer = randomBytes(8)): string {
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
  return `FS-${chars.slice(0, 4)}-${chars.slice(4, 8)}`;
}

export type Requirements = {
  lessonsDone: number;
  lessonsTotal: number;
  quizzesPassed: number;
  quizzesTotal: number;
  complete: boolean;
};

/** Where someone stands on a course's certificate. */
export async function courseRequirements(db: Database, userId: string, courseId: string): Promise<Requirements> {
  const [row] = await db.execute<{ lessons_total: number; lessons_done: number; quizzes_total: number; quizzes_passed: number }>(sql`
    with available as (
      select l.id as lesson_id, l.video_id
      from lessons l join course_modules m on m.id = l.module_id join videos v on v.id = l.video_id
      where m.course_id = ${courseId} and v.status = 'approved'
    ),
    published_quizzes as (
      select q.id from quizzes q join available a on a.lesson_id = q.lesson_id
      where q.published and exists (select 1 from quiz_questions qq where qq.quiz_id = q.id)
    )
    select
      (select count(*)::int from available) as lessons_total,
      (select count(*)::int from available a join watch_progress p on p.video_id = a.video_id and p.user_id = ${userId} and p.completed) as lessons_done,
      (select count(*)::int from published_quizzes) as quizzes_total,
      (select count(*)::int from published_quizzes q where exists (
        select 1 from quiz_attempts t where t.quiz_id = q.id and t.user_id = ${userId} and t.passed)) as quizzes_passed
  `);
  const r = { lessonsTotal: row?.lessons_total ?? 0, lessonsDone: row?.lessons_done ?? 0, quizzesTotal: row?.quizzes_total ?? 0, quizzesPassed: row?.quizzes_passed ?? 0 };
  return { ...r, complete: r.lessonsTotal > 0 && r.lessonsDone >= r.lessonsTotal && r.quizzesPassed >= r.quizzesTotal };
}

export type Certificate = typeof certificates.$inferSelect;

/** Issue the certificate if it's earned. Returns it (new or already issued), or null. */
export async function issueIfEarned(db: Database, userId: string, courseId: string, now: Date = new Date()): Promise<Certificate | null> {
  return (await issue(db, userId, courseId, now))?.certificate ?? null;
}

async function issue(db: Database, userId: string, courseId: string, now: Date): Promise<{ certificate: Certificate; isNew: boolean } | null> {
  const existing = await certificateFor(db, userId, courseId);
  if (existing) return { certificate: existing, isNew: false };
  const [course] = await db.select({ title: courses.title, published: courses.published }).from(courses).where(eq(courses.id, courseId));
  if (!course?.published) return null;
  if (!(await courseRequirements(db, userId, courseId)).complete) return null;
  const [person] = await db.select({ name: user.name }).from(user).where(eq(user.id, userId));
  if (!person) return null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const [row] = await db
      .insert(certificates)
      .values({ userId, courseId, code: certificateCode(), recipientName: person.name, courseTitle: course.title, issuedAt: now })
      .onConflictDoNothing()
      .returning();
    if (row) return { certificate: row, isNew: true };
    // Either someone else issued it a moment ago, or (very rarely) the code collided.
    const raced = await certificateFor(db, userId, courseId);
    if (raced) return { certificate: raced, isNew: false };
  }
  throw new Error("Could not generate a unique certificate code.");
}

export async function certificateFor(db: Database, userId: string, courseId: string): Promise<Certificate | null> {
  const [row] = await db.select().from(certificates).where(and(eq(certificates.userId, userId), eq(certificates.courseId, courseId)));
  return row ?? null;
}

/**
 * Check every published course a video appears in (after a lesson is finished
 * or a quiz passed). Returns only certificates issued by this call.
 */
export async function issueForVideo(db: Database, userId: string, videoId: string, now: Date = new Date()): Promise<Certificate[]> {
  const rows = await db
    .selectDistinct({ courseId: courses.id })
    .from(lessons)
    .innerJoin(courseModules, eq(lessons.moduleId, courseModules.id))
    .innerJoin(courses, eq(courseModules.courseId, courses.id))
    .where(and(eq(lessons.videoId, videoId), eq(courses.published, true)));
  const issued: Certificate[] = [];
  for (const { courseId } of rows) {
    const result = await issue(db, userId, courseId, now);
    if (result?.isNew) issued.push(result.certificate);
  }
  return issued;
}

export async function certificatesFor(db: Database, userId: string) {
  return db
    .select({ code: certificates.code, courseTitle: certificates.courseTitle, issuedAt: certificates.issuedAt, courseSlug: courses.slug })
    .from(certificates)
    .innerJoin(courses, eq(certificates.courseId, courses.id))
    .where(and(eq(certificates.userId, userId), isNull(certificates.revokedAt)))
    .orderBy(desc(certificates.issuedAt));
}

export async function certificateByCode(db: Database, code: string) {
  const [row] = await db
    .select({ certificate: certificates, courseSlug: courses.slug })
    .from(certificates)
    .innerJoin(courses, eq(certificates.courseId, courses.id))
    .where(eq(certificates.code, code.trim().toUpperCase()));
  return row ?? null;
}

/** LinkedIn's "Add licence or certification" link, prefilled. */
export function linkedInAddUrl(cert: { code: string; courseTitle: string; issuedAt: Date }, certificateUrl: string, organizationName: string): string {
  const params = new URLSearchParams({
    startTask: "CERTIFICATION_NAME",
    name: cert.courseTitle,
    organizationName,
    issueYear: String(cert.issuedAt.getUTCFullYear()),
    issueMonth: String(cert.issuedAt.getUTCMonth() + 1),
    certUrl: certificateUrl,
    certId: cert.code,
  });
  return `https://www.linkedin.com/profile/add?${params}`;
}
