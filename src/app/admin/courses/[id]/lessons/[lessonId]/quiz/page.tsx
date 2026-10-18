import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AddQuestion, QuestionItem, QuizSettings, StartQuiz } from "@/components/admin/quiz-editor";
import { Card } from "@/components/ui/card";
import { getDb } from "@/lib/db";
import { courseModules, courses, lessons, videos } from "@/lib/db/schema";
import { getQuizDrafter } from "@/lib/learning/quiz-drafter";
import { adminQuiz, QUIZ_POLICY } from "@/lib/learning/quizzes";

export const metadata: Metadata = { title: "Lesson quiz (admin)", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function AdminQuizPage({ params }: { params: Promise<{ id: string; lessonId: string }> }) {
  const { id, lessonId } = await params;
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(lessonId).success) notFound();
  const db = getDb();
  const [lesson] = await db
    .select({ title: lessons.title, summary: lessons.summary, transcript: videos.transcript, courseTitle: courses.title })
    .from(lessons)
    .innerJoin(courseModules, eq(lessons.moduleId, courseModules.id))
    .innerJoin(courses, eq(courseModules.courseId, courses.id))
    .leftJoin(videos, eq(lessons.videoId, videos.id))
    .where(and(eq(lessons.id, lessonId), eq(courseModules.courseId, id)));
  if (!lesson) notFound();
  const found = await adminQuiz(db, lessonId);
  const questions = found?.questions ?? [];
  const hasMaterial = Boolean(lesson.summary?.trim() || lesson.transcript?.trim());
  const canDraft = getQuizDrafter() !== null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <Link href={`/admin/courses/${id}`} className="text-sm text-muted underline">
        ← {lesson.courseTitle}
      </Link>
      <h1 className="mt-3 text-3xl font-semibold">Quiz: {lesson.title}</h1>
      <p className="mt-2 text-muted">
        Members who can watch the lesson take the quiz after it. Passing every published quiz in a course (and finishing its lessons) earns the course certificate.
      </p>

      {found && (
        <Card className="mt-6">
          <QuizSettings quizId={found.quiz.id} passPercent={found.quiz.passPercent} published={found.quiz.published} questions={questions.length} />
        </Card>
      )}

      {questions.length > 0 ? (
        <section className="mt-8" aria-labelledby="questions">
          <h2 id="questions" className="text-2xl font-semibold">
            Questions <span className="text-base font-normal text-muted">({questions.length} of up to {QUIZ_POLICY.maxQuestions})</span>
          </h2>
          <Card className="mt-4 p-0">
            <ol className="divide-y divide-navy-900/10">
              {questions.map((q, i) => (
                <li key={q.id}>
                  <QuestionItem question={q} index={i} first={i === 0} last={i === questions.length - 1} />
                </li>
              ))}
            </ol>
          </Card>
        </section>
      ) : (
        <Card className="mt-6">
          <h2 className="text-xl font-semibold">No questions yet</h2>
          <p className="mt-1 mb-4 text-muted">A good quiz has 3 to 6 questions about the lesson&apos;s main ideas.</p>
          <StartQuiz lessonId={lessonId} hasQuiz={Boolean(found)} canDraft={canDraft} hasMaterial={hasMaterial} />
        </Card>
      )}

      {found && (
        <div className="mt-6 space-y-4">
          {questions.length < QUIZ_POLICY.maxQuestions && <AddQuestion quizId={found.quiz.id} />}
          {questions.length > 0 && canDraft && !found.quiz.published && questions.length < QUIZ_POLICY.maxQuestions && (
            <StartQuiz lessonId={lessonId} hasQuiz canDraft hasMaterial={hasMaterial} />
          )}
        </div>
      )}
    </div>
  );
}
