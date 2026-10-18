/**
 * End-of-lesson quizzes (docs/development-plan.md Phase 2: certificates and
 * quizzes). Admins write them (optionally from an AI draft); members who can
 * watch the lesson take them. Answers are graded on the server and the correct
 * answers never reach the browser before submission.
 */
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, lt, sql } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth";
import type { Database } from "@/lib/db";
import { lessons, quizAttempts, quizQuestions, quizzes, videos, type QuizOption } from "@/lib/db/schema";
import { accessFor, loadViewer } from "@/lib/playback/access";

export const QUIZ_POLICY = {
  minOptions: 2,
  maxOptions: 6,
  maxQuestions: 20,
  defaultPassPercent: 70,
} as const;

export class QuizError extends Error {
  constructor(
    readonly reason: "not_found" | "invalid" | "not_allowed" | "not_publishable",
    message: string,
  ) {
    super(message);
    this.name = "QuizError";
  }
}

export type QuestionInput = {
  prompt: string;
  kind: "single" | "multiple";
  /** Option texts in display order. */
  options: string[];
  /** Indexes into `options` of the correct answers. */
  correct: number[];
  explanation?: string | null;
};

/** Why a question can't be saved, or null. */
export function questionProblem(q: QuestionInput): string | null {
  if (q.prompt.trim().length < 5) return "Write the question.";
  const options = q.options.map((o) => o.trim()).filter(Boolean);
  if (options.length !== q.options.length) return "Options can't be empty.";
  if (options.length < QUIZ_POLICY.minOptions || options.length > QUIZ_POLICY.maxOptions) {
    return `Give ${QUIZ_POLICY.minOptions} to ${QUIZ_POLICY.maxOptions} options.`;
  }
  if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) return "Two options are the same.";
  const correct = [...new Set(q.correct)];
  if (correct.some((i) => !Number.isInteger(i) || i < 0 || i >= options.length)) return "Mark the correct answer.";
  if (q.kind === "single" && correct.length !== 1) return "Single-answer questions need exactly one correct option.";
  if (q.kind === "multiple" && correct.length < 1) return "Mark at least one correct option.";
  return null;
}

function toRow(q: QuestionInput) {
  const options: QuizOption[] = q.options.map((text) => ({ id: randomUUID().slice(0, 8), text: text.trim() }));
  return {
    prompt: q.prompt.trim(),
    kind: q.kind,
    options,
    correctOptionIds: [...new Set(q.correct)].sort((a, b) => a - b).map((i) => options[i]!.id),
    explanation: q.explanation?.trim() || null,
  };
}

// ---------------------------------------------------------------------------
// Grading (pure)
// ---------------------------------------------------------------------------

export type GradedQuestion = { questionId: string; correct: boolean; chosen: string[]; correctOptionIds: string[]; explanation: string | null };

/** A question is right only when exactly the correct options are chosen. Unanswered counts as wrong. */
export function grade(
  questions: { id: string; correctOptionIds: string[]; explanation: string | null }[],
  answers: Record<string, string[]>,
  passPercent: number,
): { scorePercent: number; passed: boolean; results: GradedQuestion[] } {
  const results = questions.map((q) => {
    const chosen = [...new Set(answers[q.id] ?? [])].sort();
    const right = [...q.correctOptionIds].sort();
    return {
      questionId: q.id,
      chosen,
      correctOptionIds: q.correctOptionIds,
      explanation: q.explanation,
      correct: chosen.length === right.length && chosen.every((c, i) => c === right[i]),
    };
  });
  const scorePercent = questions.length ? Math.round((results.filter((r) => r.correct).length / questions.length) * 100) : 0;
  return { scorePercent, passed: questions.length > 0 && scorePercent >= passPercent, results };
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export async function getOrCreateQuiz(db: Database, lessonId: string) {
  const [lesson] = await db.select({ id: lessons.id }).from(lessons).where(eq(lessons.id, lessonId));
  if (!lesson) throw new QuizError("not_found", "Lesson not found.");
  await db.insert(quizzes).values({ lessonId }).onConflictDoNothing({ target: quizzes.lessonId });
  const [quiz] = await db.select().from(quizzes).where(eq(quizzes.lessonId, lessonId));
  return quiz!;
}

/** The quiz with every question and its answers, for the editor. */
export async function adminQuiz(db: Database, lessonId: string) {
  const [quiz] = await db.select().from(quizzes).where(eq(quizzes.lessonId, lessonId));
  if (!quiz) return null;
  const questions = await db.select().from(quizQuestions).where(eq(quizQuestions.quizId, quiz.id)).orderBy(asc(quizQuestions.position));
  return { quiz, questions };
}

export async function updateQuiz(db: Database, quizId: string, changes: { passPercent?: number; published?: boolean }) {
  if (changes.passPercent !== undefined && (changes.passPercent < 1 || changes.passPercent > 100)) {
    throw new QuizError("invalid", "The pass mark is a percentage from 1 to 100.");
  }
  if (changes.published) {
    const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(quizQuestions).where(eq(quizQuestions.quizId, quizId));
    if (n === 0) throw new QuizError("not_publishable", "Add at least one question before publishing.");
  }
  const [row] = await db.update(quizzes).set(changes).where(eq(quizzes.id, quizId)).returning();
  if (!row) throw new QuizError("not_found", "Quiz not found.");
  return row;
}

export async function addQuestions(db: Database, quizId: string, inputs: QuestionInput[]) {
  for (const q of inputs) {
    const problem = questionProblem(q);
    if (problem) throw new QuizError("invalid", problem);
  }
  return db.transaction(async (tx) => {
    const [quiz] = await tx.select({ id: quizzes.id }).from(quizzes).where(eq(quizzes.id, quizId)).for("update");
    if (!quiz) throw new QuizError("not_found", "Quiz not found.");
    const [{ count, next } = { count: 0, next: 1 }] = await tx
      .select({ count: sql<number>`count(*)::int`, next: sql<number>`coalesce(max(${quizQuestions.position}), 0)::int + 1` })
      .from(quizQuestions)
      .where(eq(quizQuestions.quizId, quizId));
    if (count + inputs.length > QUIZ_POLICY.maxQuestions) throw new QuizError("invalid", `A quiz can have up to ${QUIZ_POLICY.maxQuestions} questions.`);
    if (inputs.length === 0) return [];
    return tx
      .insert(quizQuestions)
      .values(inputs.map((q, i) => ({ quizId, position: next + i, ...toRow(q) })))
      .returning();
  });
}

export async function updateQuestion(db: Database, questionId: string, input: QuestionInput) {
  const problem = questionProblem(input);
  if (problem) throw new QuizError("invalid", problem);
  const [row] = await db.update(quizQuestions).set(toRow(input)).where(eq(quizQuestions.id, questionId)).returning();
  if (!row) throw new QuizError("not_found", "Question not found.");
  return row;
}

/** Delete a question. A published quiz left with none is unpublished. */
export async function deleteQuestion(db: Database, questionId: string) {
  await db.transaction(async (tx) => {
    const [row] = await tx.delete(quizQuestions).where(eq(quizQuestions.id, questionId)).returning({ quizId: quizQuestions.quizId });
    if (!row) throw new QuizError("not_found", "Question not found.");
    const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(quizQuestions).where(eq(quizQuestions.quizId, row.quizId));
    if (n === 0) await tx.update(quizzes).set({ published: false }).where(eq(quizzes.id, row.quizId));
  });
}

export async function moveQuestion(db: Database, questionId: string, direction: "up" | "down"): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [q] = await tx.select().from(quizQuestions).where(eq(quizQuestions.id, questionId)).for("update");
    if (!q) throw new QuizError("not_found", "Question not found.");
    const [neighbor] = await tx
      .select({ id: quizQuestions.id, position: quizQuestions.position })
      .from(quizQuestions)
      .where(and(eq(quizQuestions.quizId, q.quizId), direction === "up" ? lt(quizQuestions.position, q.position) : gt(quizQuestions.position, q.position)))
      .orderBy(direction === "up" ? desc(quizQuestions.position) : asc(quizQuestions.position))
      .limit(1);
    if (!neighbor) return false;
    await tx.update(quizQuestions).set({ position: neighbor.position }).where(eq(quizQuestions.id, q.id));
    await tx.update(quizQuestions).set({ position: q.position }).where(eq(quizQuestions.id, neighbor.id));
    return true;
  });
}

// ---------------------------------------------------------------------------
// Learners
// ---------------------------------------------------------------------------

export type LearnerQuiz = {
  id: string;
  passPercent: number;
  questions: { id: string; prompt: string; kind: "single" | "multiple"; options: QuizOption[] }[];
  best: { scorePercent: number; passed: boolean } | null;
  attempts: number;
};

/** A lesson's published quiz as the learner sees it: no correct answers, plus their best result. */
export async function quizForLearner(db: Database, lessonId: string, userId: string | null): Promise<LearnerQuiz | null> {
  const [quiz] = await db.select().from(quizzes).where(and(eq(quizzes.lessonId, lessonId), eq(quizzes.published, true)));
  if (!quiz) return null;
  const questions = await db
    .select({ id: quizQuestions.id, prompt: quizQuestions.prompt, kind: quizQuestions.kind, options: quizQuestions.options })
    .from(quizQuestions)
    .where(eq(quizQuestions.quizId, quiz.id))
    .orderBy(asc(quizQuestions.position));
  if (questions.length === 0) return null;
  let best: LearnerQuiz["best"] = null;
  let attempts = 0;
  if (userId) {
    const rows = await db
      .select({ scorePercent: quizAttempts.scorePercent, passed: quizAttempts.passed })
      .from(quizAttempts)
      .where(and(eq(quizAttempts.quizId, quiz.id), eq(quizAttempts.userId, userId)))
      .orderBy(desc(quizAttempts.passed), desc(quizAttempts.scorePercent));
    best = rows[0] ?? null;
    attempts = rows.length;
  }
  return { id: quiz.id, passPercent: quiz.passPercent, questions, best, attempts };
}

/** Grade and record an attempt. Only viewers who can watch the lesson may take its quiz. */
export async function submitQuiz(db: Database, sessionUser: SessionUser, quizId: string, answers: Record<string, string[]>, now: Date = new Date()) {
  const [found] = await db
    .select({ quiz: quizzes, video: videos })
    .from(quizzes)
    .innerJoin(lessons, eq(quizzes.lessonId, lessons.id))
    .innerJoin(videos, eq(lessons.videoId, videos.id))
    .where(and(eq(quizzes.id, quizId), eq(quizzes.published, true)));
  if (!found) throw new QuizError("not_found", "Quiz not found.");
  if (!(await accessFor(db, found.video, await loadViewer(db, sessionUser))).allowed) {
    throw new QuizError("not_allowed", "Quizzes are for members who can watch the lesson.");
  }
  const questions = await db
    .select({ id: quizQuestions.id, options: quizQuestions.options, correctOptionIds: quizQuestions.correctOptionIds, explanation: quizQuestions.explanation })
    .from(quizQuestions)
    .where(eq(quizQuestions.quizId, quizId))
    .orderBy(asc(quizQuestions.position));
  // Keep only real questions and options, so the stored attempt is clean.
  const clean = Object.fromEntries(
    questions.map((q) => [q.id, [...new Set(answers[q.id] ?? [])].filter((id) => q.options.some((o) => o.id === id))]),
  );
  const result = grade(questions, clean, found.quiz.passPercent);
  await db.insert(quizAttempts).values({ quizId, userId: sessionUser.id, answers: clean, scorePercent: result.scorePercent, passed: result.passed, createdAt: now });
  return { ...result, passPercent: found.quiz.passPercent, videoId: found.video.id };
}

/** Lessons in a course with a published quiz, and whether this person has passed each. */
export async function courseQuizStatus(db: Database, courseId: string, userId: string | null): Promise<Map<string, { passed: boolean }>> {
  const rows = await db.execute<{ lesson_id: string; passed: boolean }>(sql`
    select q.lesson_id,
      ${userId ? sql`exists (select 1 from quiz_attempts t where t.quiz_id = q.id and t.user_id = ${userId} and t.passed)` : sql`false`} as passed
    from quizzes q
    join lessons l on l.id = q.lesson_id
    join course_modules m on m.id = l.module_id
    where m.course_id = ${courseId} and q.published
      and exists (select 1 from quiz_questions qq where qq.quiz_id = q.id)
  `);
  return new Map(rows.map((r) => [r.lesson_id, { passed: r.passed }]));
}
