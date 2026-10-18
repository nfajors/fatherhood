"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import type { LearnerQuiz } from "@/lib/learning/quizzes";

type Result = {
  scorePercent: number;
  passed: boolean;
  passPercent: number;
  results: { questionId: string; correct: boolean; chosen: string[]; correctOptionIds: string[]; explanation: string | null }[];
  certificates: { code: string; courseTitle: string }[];
};

/** The end-of-lesson quiz: answer, submit, see what was right and why, retake. */
export function LessonQuiz({ quiz, signInHref }: { quiz: LearnerQuiz; signInHref: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const n = quiz.questions.length;
  const answered = quiz.questions.filter((q) => answers[q.id]?.length).length;

  function choose(questionId: string, optionId: string, multiple: boolean) {
    setAnswers((a) => {
      const current = a[questionId] ?? [];
      const next = multiple ? (current.includes(optionId) ? current.filter((id) => id !== optionId) : [...current, optionId]) : [optionId];
      return { ...a, [questionId]: next };
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/quizzes/${quiz.id}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      const data = (await res.json().catch(() => ({}))) as Result & { message?: string; error?: string };
      if (!res.ok) throw new Error(data.message ?? data.error ?? `Something went wrong (${res.status}).`);
      setResult(data);
      router.refresh();
      document.getElementById("quiz-result")?.focus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  function retake() {
    setAnswers({});
    setResult(null);
    setOpen(true);
  }

  const graded = new Map(result?.results.map((r) => [r.questionId, r]));

  return (
    <section aria-labelledby="quiz" className="mt-8 rounded-xl border border-navy-900/10 bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="quiz" className="text-xl font-semibold">
            Check your understanding
          </h2>
          <p className="mt-1 text-sm text-muted">
            {n} question{n === 1 ? "" : "s"} · pass mark {quiz.passPercent}%
            {quiz.best && !result && (
              <>
                {" · "}
                <span className={quiz.best.passed ? "font-medium text-green-800" : ""}>
                  {quiz.best.passed ? `Passed (best ${quiz.best.scorePercent}%)` : `Best so far ${quiz.best.scorePercent}%`}
                </span>
              </>
            )}
          </p>
        </div>
        {!open && !result && (
          signInHref ? (
            <Button asChild variant="secondary" size="sm">
              <Link href={signInHref}>Sign in to take the quiz</Link>
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
              {quiz.attempts > 0 ? "Take it again" : "Start quiz"}
            </Button>
          )
        )}
      </div>

      {result && (
        <div
          id="quiz-result"
          tabIndex={-1}
          role="status"
          className={`mt-4 rounded-lg p-4 outline-none ${result.passed ? "bg-green-50 text-green-900" : "bg-amber-50 text-amber-900"}`}
        >
          <p className="font-semibold">
            {result.passed ? `You passed with ${result.scorePercent}%.` : `You scored ${result.scorePercent}%. You need ${result.passPercent}% to pass.`}
          </p>
          <p className="mt-1 text-sm">
            {result.passed ? "Well done. The answers and explanations are below." : "Read the explanations below, then try again whenever you're ready."}
          </p>
          {result.certificates.map((c) => (
            <p key={c.code} className="mt-3 rounded-md bg-white p-3 text-navy-900">
              <span aria-hidden>🎓 </span>
              You&apos;ve earned your certificate for <strong>{c.courseTitle}</strong>.{" "}
              <Link href={`/certificates/${c.code}`} className="font-semibold underline">
                View certificate
              </Link>
            </p>
          ))}
          <Button size="sm" variant="outline" className="mt-3" onClick={retake}>
            Retake quiz
          </Button>
        </div>
      )}

      {(open || result) && (
        <form onSubmit={submit} className="mt-5">
          <ol className="space-y-6">
            {quiz.questions.map((q, i) => {
              const g = graded.get(q.id);
              const multiple = q.kind === "multiple";
              return (
                <li key={q.id}>
                  <fieldset disabled={Boolean(result)}>
                    <legend className="font-medium text-navy-900">
                      {i + 1}. {q.prompt}
                      {multiple && <span className="ml-1 text-sm font-normal text-muted">(choose all that apply)</span>}
                    </legend>
                    <ul className="mt-2 space-y-2">
                      {q.options.map((o) => {
                        const chosen = (g?.chosen ?? answers[q.id] ?? []).includes(o.id);
                        const right = g?.correctOptionIds.includes(o.id);
                        const tone = !g ? "border-navy-900/15" : right ? "border-green-600 bg-green-50" : chosen ? "border-red-400 bg-red-50" : "border-navy-900/10";
                        return (
                          <li key={o.id}>
                            <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${tone}`}>
                              <input
                                type={multiple ? "checkbox" : "radio"}
                                name={`q-${q.id}`}
                                className="mt-1"
                                checked={chosen}
                                onChange={() => choose(q.id, o.id, multiple)}
                              />
                              <span className="min-w-0 flex-1">
                                {o.text}
                                {g && right && <span className="ml-2 text-sm font-medium text-green-800">Correct answer</span>}
                                {g && chosen && !right && <span className="ml-2 text-sm font-medium text-red-700">Your answer</span>}
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </fieldset>
                  {g && (
                    <p className={`mt-2 text-sm ${g.correct ? "text-green-800" : "text-ink"}`}>
                      <strong>{g.correct ? "Right." : "Not quite."}</strong> {g.explanation}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
          {!result && (
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={pending || answered === 0}>
                {pending ? "Checking…" : "Submit answers"}
              </Button>
              <span className="text-sm text-muted">
                {answered} of {n} answered
              </span>
            </div>
          )}
          {error && (
            <p role="alert" className="mt-2 text-sm text-red-700">
              {error}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
