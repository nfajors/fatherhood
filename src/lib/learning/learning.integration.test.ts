/**
 * Quizzes and certificates against a real Postgres. Runs only when
 * TEST_DATABASE_URL points at a disposable database (tables are truncated).
 */
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "@/lib/auth";
import { addLesson, addModule, createCourse, setPublished } from "@/lib/courses/admin";
import type { Database } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { setCompleted } from "@/lib/playback/service";
import { certificateByCode, certificatesFor, courseRequirements, issueForVideo, issueIfEarned } from "./certificates";
import { draftQuizForLesson, type QuizDrafter } from "./quiz-drafter";
import {
  addQuestions,
  adminQuiz,
  courseQuizStatus,
  deleteQuestion,
  getOrCreateQuiz,
  moveQuestion,
  quizForLearner,
  submitQuiz,
  updateQuestion,
  updateQuiz,
  type QuestionInput,
} from "./quizzes";

const url = process.env.TEST_DATABASE_URL;
const T0 = new Date("2026-10-18T12:00:00Z");
const person = (id: string, role: SessionUser["role"] = "user"): SessionUser => ({ id, role, email: `${id}@test.dev`, name: id, stripeCustomerId: null });
const member = person("member");

const q1: QuestionInput = { prompt: "What comes first?", kind: "single", options: ["Listening", "Fixing", "Lecturing"], correct: [0], explanation: "Listen first." };
const q2: QuestionInput = { prompt: "Which show presence?", kind: "multiple", options: ["Eye contact", "Phone out", "Asking questions"], correct: [0, 2] };

describe.skipIf(!url)("quizzes and certificates (Postgres)", () => {
  let client: postgres.Sql;
  let db: Database;

  beforeAll(async () => {
    client = postgres(url!, { max: 4, onnotice: () => {} });
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: "drizzle" });
  });

  afterAll(async () => {
    await client?.end();
  });

  let n = 0;
  async function video(overrides: Partial<typeof schema.videos.$inferInsert> = {}) {
    n++;
    const [row] = await db
      .insert(schema.videos)
      .values({ type: "professional", status: "approved", creatorId: "author", title: `Video ${n}`, cloudflareUid: `cf${n}`, durationSeconds: 300, requireSignedUrls: true, ...overrides })
      .returning();
    return row!;
  }

  /** A published course with two lessons; the first has a quiz. */
  async function course() {
    const c = await createCourse(db, { title: "Present Fathers" });
    const m = await addModule(db, c.id, "M");
    const v1 = await video({ transcript: "Listen before you fix." });
    const v2 = await video();
    const l1 = await addLesson(db, m.id, { title: "Listening", videoId: v1.id, summary: "Why listening matters." });
    const l2 = await addLesson(db, m.id, { title: "Showing up", videoId: v2.id });
    await setPublished(db, c.id, true);
    return { c, v1, v2, l1, l2 };
  }

  beforeEach(async () => {
    await db.execute(
      sql`truncate certificates, quiz_attempts, quiz_questions, quizzes, watch_progress, lessons, course_modules, courses, subscriptions, videos, "user" cascade`,
    );
    await db.insert(schema.user).values([
      { id: "author", name: "The Author", email: "author@test.dev", role: "admin" },
      { id: "member", name: "Marcus Bell", email: "member@test.dev" },
      { id: "visitor", name: "Visitor", email: "visitor@test.dev" },
    ]);
    await db.insert(schema.subscriptions).values({ userId: "member", plan: "annual", status: "active", currentPeriodEnd: new Date("2030-01-01") });
    n = 0;
  });

  it("edits a quiz: create once, add, edit, reorder, publish, delete", async () => {
    const { l1 } = await course();
    const quiz = await getOrCreateQuiz(db, l1.id);
    expect(await getOrCreateQuiz(db, l1.id)).toMatchObject({ id: quiz.id, published: false, passPercent: 70 });
    await expect(updateQuiz(db, quiz.id, { published: true })).rejects.toMatchObject({ reason: "not_publishable" });
    await expect(updateQuiz(db, quiz.id, { passPercent: 0 })).rejects.toMatchObject({ reason: "invalid" });

    const [a, b] = await addQuestions(db, quiz.id, [q1, q2]);
    expect(a).toMatchObject({ position: 1, prompt: q1.prompt, explanation: "Listen first." });
    expect(a!.correctOptionIds).toEqual([a!.options[0]!.id]);
    expect(b!.correctOptionIds).toEqual([b!.options[0]!.id, b!.options[2]!.id]);
    await expect(addQuestions(db, quiz.id, [{ ...q1, correct: [] }])).rejects.toMatchObject({ reason: "invalid" });
    await expect(addQuestions(db, quiz.id, Array.from({ length: 19 }, () => q1))).rejects.toThrow(/up to 20/);

    await updateQuestion(db, b!.id, { ...q2, prompt: "Which of these show presence?" });
    expect(await moveQuestion(db, b!.id, "up")).toBe(true);
    expect(await moveQuestion(db, b!.id, "up")).toBe(false);
    expect((await adminQuiz(db, l1.id))!.questions.map((q) => q.prompt)).toEqual(["Which of these show presence?", q1.prompt]);

    await updateQuiz(db, quiz.id, { published: true, passPercent: 50 });
    await deleteQuestion(db, a!.id);
    expect((await adminQuiz(db, l1.id))!.quiz.published).toBe(true);
    // Deleting the last question unpublishes the quiz.
    await deleteQuestion(db, b!.id);
    expect((await adminQuiz(db, l1.id))!.quiz.published).toBe(false);
  });

  it("lets members take a published quiz, hiding answers until they submit", async () => {
    const { l1, l2 } = await course();
    const quiz = await getOrCreateQuiz(db, l1.id);
    const [a, b] = await addQuestions(db, quiz.id, [q1, q2]);

    expect(await quizForLearner(db, l1.id, "member")).toBeNull();
    await expect(submitQuiz(db, member, quiz.id, {})).rejects.toMatchObject({ reason: "not_found" });
    await updateQuiz(db, quiz.id, { published: true });

    const shown = (await quizForLearner(db, l1.id, "member"))!;
    expect(shown).toMatchObject({ id: quiz.id, passPercent: 70, best: null, attempts: 0 });
    expect(JSON.stringify(shown)).not.toContain("correctOptionIds");
    expect(await quizForLearner(db, l2.id, "member")).toBeNull();

    // Non-members can't take a members-only lesson's quiz.
    await expect(submitQuiz(db, person("visitor"), quiz.id, {})).rejects.toMatchObject({ reason: "not_allowed" });

    // Half right; unknown questions and options are dropped from the stored attempt.
    const first = await submitQuiz(db, member, quiz.id, { [a!.id]: [a!.options[0]!.id], [b!.id]: [b!.options[0]!.id], bogus: ["x"] }, T0);
    expect(first).toMatchObject({ scorePercent: 50, passed: false, passPercent: 70 });
    expect(first.results[0]).toMatchObject({ correct: true, explanation: "Listen first." });
    const [stored] = await db.select().from(schema.quizAttempts);
    expect(Object.keys(stored!.answers).sort()).toEqual([a!.id, b!.id].sort());

    const second = await submitQuiz(db, member, quiz.id, { [a!.id]: [a!.options[0]!.id], [b!.id]: [b!.options[2]!.id, b!.options[0]!.id, "nope"] });
    expect(second).toMatchObject({ scorePercent: 100, passed: true });
    expect((await quizForLearner(db, l1.id, "member"))!).toMatchObject({ best: { scorePercent: 100, passed: true }, attempts: 2 });
  });

  it("issues a certificate once every lesson is finished and every quiz passed", async () => {
    const { c, v1, v2, l1 } = await course();
    expect(await courseRequirements(db, "member", c.id)).toEqual({ lessonsDone: 0, lessonsTotal: 2, quizzesPassed: 0, quizzesTotal: 0, complete: false });

    const quiz = await getOrCreateQuiz(db, l1.id);
    const [a] = await addQuestions(db, quiz.id, [q1]);
    await updateQuiz(db, quiz.id, { published: true });
    expect([...(await courseQuizStatus(db, c.id, "member"))]).toEqual([[l1.id, { passed: false }]]);

    await setCompleted(db, "member", v1.id, true);
    await setCompleted(db, "member", v2.id, true);
    expect(await courseRequirements(db, "member", c.id)).toMatchObject({ lessonsDone: 2, quizzesTotal: 1, quizzesPassed: 0, complete: false });
    expect(await issueForVideo(db, "member", v2.id)).toEqual([]);

    await submitQuiz(db, member, quiz.id, { [a!.id]: [a!.options[0]!.id] });
    expect((await courseQuizStatus(db, c.id, "member")).get(l1.id)).toEqual({ passed: true });
    const [issued] = await issueForVideo(db, "member", v1.id, T0);
    expect(issued).toMatchObject({ userId: "member", courseId: c.id, recipientName: "Marcus Bell", courseTitle: "Present Fathers", issuedAt: T0 });
    expect(issued!.code).toMatch(/^FS-\w{4}-\w{4}$/);

    // Idempotent: later checks find the same certificate and report nothing new.
    expect(await issueForVideo(db, "member", v1.id)).toEqual([]);
    expect((await issueIfEarned(db, "member", c.id))!.code).toBe(issued!.code);
    expect(await db.$count(schema.certificates)).toBe(1);

    expect(await certificatesFor(db, "member")).toEqual([{ code: issued!.code, courseTitle: "Present Fathers", issuedAt: T0, courseSlug: c.slug }]);
    expect((await certificateByCode(db, ` ${issued!.code.toLowerCase()} `))!.certificate.id).toBe(issued!.id);
    expect(await certificateByCode(db, "FS-0000-0000")).toBeNull();

    // A revoked certificate stays verifiable as revoked but leaves the person's list.
    await db.update(schema.certificates).set({ revokedAt: T0 });
    expect(await certificatesFor(db, "member")).toEqual([]);
  });

  it("ignores unavailable lessons and unpublished courses", async () => {
    const { c, v1, v2 } = await course();
    await setCompleted(db, "member", v1.id, true);
    // The second lesson's video is pulled: only available lessons count.
    await db.update(schema.videos).set({ status: "unpublished" }).where(sql`${schema.videos.id} = ${v2.id}`);
    expect(await courseRequirements(db, "member", c.id)).toMatchObject({ lessonsDone: 1, lessonsTotal: 1, complete: true });

    await db.update(schema.courses).set({ published: false });
    expect(await issueIfEarned(db, "member", c.id)).toBeNull();
    await db.update(schema.courses).set({ published: true });
    expect(await issueIfEarned(db, "member", c.id)).not.toBeNull();
  });

  it("drafts questions into an unpublished quiz", async () => {
    const { l1, l2 } = await course();
    const seen: unknown[] = [];
    const drafter: QuizDrafter = {
      model: "fake",
      async draft(lesson, count) {
        seen.push({ lesson, count });
        return [q1, q2];
      },
    };
    const { quizId, added } = await draftQuizForLesson(db, drafter, l1.id);
    expect(added).toHaveLength(2);
    expect(seen).toEqual([{ lesson: { lessonTitle: "Listening", summary: "Why listening matters.", transcript: "Listen before you fix.", courseTitle: "Present Fathers" }, count: 5 }]);
    expect((await adminQuiz(db, l1.id))!.quiz).toMatchObject({ id: quizId, published: false });

    // No summary and no transcript: nothing to draft from.
    await expect(draftQuizForLesson(db, drafter, l2.id)).rejects.toMatchObject({ reason: "invalid" });
    // Published quizzes don't take unreviewed drafts.
    await updateQuiz(db, quizId, { published: true });
    await expect(draftQuizForLesson(db, drafter, l1.id)).rejects.toMatchObject({ reason: "not_allowed" });
  });
});
