"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { ErrorText, useApiAction } from "@/components/use-api-action";

const field = "mt-1 block w-full rounded-md border border-navy-900/20 bg-white px-3 py-2";
const MAX_OPTIONS = 6;
const MIN_OPTIONS = 2;

export type EditorQuestion = {
  id: string;
  prompt: string;
  kind: "single" | "multiple";
  options: { id: string; text: string }[];
  correctOptionIds: string[];
  explanation: string | null;
};

type Draft = { prompt: string; kind: "single" | "multiple"; options: string[]; correct: number[]; explanation: string };

const blank: Draft = { prompt: "", kind: "single", options: ["", "", ""], correct: [], explanation: "" };

function toDraft(q: EditorQuestion): Draft {
  return {
    prompt: q.prompt,
    kind: q.kind,
    options: q.options.map((o) => o.text),
    correct: q.options.flatMap((o, i) => (q.correctOptionIds.includes(o.id) ? [i] : [])),
    explanation: q.explanation ?? "",
  };
}

/** Create the quiz or have the AI draft one. Shown when a lesson has no questions yet. */
export function StartQuiz({ lessonId, hasQuiz, canDraft, hasMaterial }: { lessonId: string; hasQuiz: boolean; canDraft: boolean; hasMaterial: boolean }) {
  const { pending, error, run } = useApiAction();
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {canDraft && (
          <Button disabled={pending || !hasMaterial} onClick={() => run(`/api/admin/quizzes/lessons/${lessonId}/draft`, "POST")}>
            {pending ? "Drafting…" : "Draft questions with AI"}
          </Button>
        )}
        {!hasQuiz && (
          <Button variant={canDraft ? "secondary" : "primary"} disabled={pending} onClick={() => run(`/api/admin/quizzes/lessons/${lessonId}`, "POST")}>
            Write questions myself
          </Button>
        )}
      </div>
      {canDraft && !hasMaterial && (
        <p className="mt-2 text-sm text-muted">AI drafting needs a lesson summary or the video&apos;s transcript.</p>
      )}
      {canDraft && hasMaterial && (
        <p className="mt-2 text-sm text-muted">Drafts are saved unpublished. Read every question before you publish.</p>
      )}
      <ErrorText error={error} />
    </div>
  );
}

/** Pass mark and publish state. */
export function QuizSettings({ quizId, passPercent, published, questions }: { quizId: string; passPercent: number; published: boolean; questions: number }) {
  const { pending, error, run } = useApiAction();
  const url = `/api/admin/quizzes/${quizId}`;
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            run(url, "PATCH", { passPercent: Number(new FormData(event.currentTarget).get("passPercent")) });
          }}
        >
          <label className="block text-sm font-medium">
            Pass mark (%)
            <input name="passPercent" type="number" min={1} max={100} defaultValue={passPercent} required className={`${field} w-24`} />
          </label>
          <Button size="sm" variant="secondary" type="submit" disabled={pending}>
            Save
          </Button>
        </form>
        <div className="flex items-center gap-3">
          <span className={`rounded px-2 py-0.5 text-sm ${published ? "bg-green-100 text-green-800" : "bg-navy-900/5 text-muted"}`}>
            {published ? "Published" : "Draft"}
          </span>
          <Button size="sm" disabled={pending || (!published && questions === 0)} onClick={() => run(url, "PATCH", { published: !published })}>
            {published ? "Unpublish" : "Publish quiz"}
          </Button>
        </div>
      </div>
      <ErrorText error={error} />
    </div>
  );
}

function QuestionForm({ initial, submitLabel, onSubmit, onCancel, pending }: {
  initial: Draft;
  submitLabel: string;
  onSubmit: (draft: Draft) => void;
  onCancel?: () => void;
  pending: boolean;
}) {
  const [draft, setDraft] = useState<Draft>(initial);
  const set = (changes: Partial<Draft>) => setDraft((d) => ({ ...d, ...changes }));

  function toggleCorrect(i: number) {
    if (draft.kind === "single") set({ correct: [i] });
    else set({ correct: draft.correct.includes(i) ? draft.correct.filter((c) => c !== i) : [...draft.correct, i] });
  }
  function removeOption(i: number) {
    set({ options: draft.options.filter((_, j) => j !== i), correct: draft.correct.filter((c) => c !== i).map((c) => (c > i ? c - 1 : c)) });
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit(draft);
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block text-sm font-medium">
        Question
        <textarea value={draft.prompt} onChange={(e) => set({ prompt: e.target.value })} required rows={2} maxLength={1000} className={field} />
      </label>
      <fieldset className="flex flex-wrap gap-4 text-sm">
        <legend className="sr-only">Answer type</legend>
        <label className="flex items-center gap-2">
          <input type="radio" checked={draft.kind === "single"} onChange={() => set({ kind: "single", correct: draft.correct.slice(0, 1) })} /> One correct answer
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" checked={draft.kind === "multiple"} onChange={() => set({ kind: "multiple" })} /> Choose all that apply
        </label>
      </fieldset>
      <fieldset>
        <legend className="text-sm font-medium">Options (mark the correct {draft.kind === "single" ? "one" : "ones"})</legend>
        <ol className="mt-1 space-y-2">
          {draft.options.map((text, i) => (
            <li key={i} className="flex items-center gap-2">
              <input
                type={draft.kind === "single" ? "radio" : "checkbox"}
                name="correct"
                checked={draft.correct.includes(i)}
                onChange={() => toggleCorrect(i)}
                aria-label={`Option ${i + 1} is correct`}
              />
              <input
                value={text}
                onChange={(e) => set({ options: draft.options.map((o, j) => (j === i ? e.target.value : o)) })}
                required
                maxLength={300}
                aria-label={`Option ${i + 1}`}
                className="block w-full min-w-0 rounded-md border border-navy-900/20 bg-white px-3 py-1.5"
              />
              <Button size="sm" variant="ghost" type="button" disabled={draft.options.length <= MIN_OPTIONS} onClick={() => removeOption(i)} aria-label={`Remove option ${i + 1}`}>
                ✕
              </Button>
            </li>
          ))}
        </ol>
        {draft.options.length < MAX_OPTIONS && (
          <Button size="sm" variant="ghost" type="button" className="mt-1" onClick={() => set({ options: [...draft.options, ""] })}>
            + Add option
          </Button>
        )}
      </fieldset>
      <label className="block text-sm font-medium">
        Explanation <span className="font-normal text-muted">(shown after answering)</span>
        <textarea value={draft.explanation} onChange={(e) => set({ explanation: e.target.value })} rows={2} maxLength={2000} className={field} />
      </label>
      <div className="flex gap-2">
        <Button size="sm" type="submit" disabled={pending}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button size="sm" variant="ghost" type="button" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

const payload = (d: Draft) => ({ prompt: d.prompt, kind: d.kind, options: d.options, correct: d.correct, explanation: d.explanation || null });

export function QuestionItem({ question, index, first, last }: { question: EditorQuestion; index: number; first: boolean; last: boolean }) {
  const { pending, error, run } = useApiAction();
  const [editing, setEditing] = useState(false);
  const url = `/api/admin/quizzes/questions/${question.id}`;

  return (
    <div className="p-4">
      {editing ? (
        <QuestionForm initial={toDraft(question)} submitLabel="Save question" pending={pending} onSubmit={(d) => run(url, "PATCH", payload(d), () => setEditing(false))} onCancel={() => setEditing(false)} />
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1">
            <p className="font-medium text-navy-900">
              {index + 1}. {question.prompt}
              {question.kind === "multiple" && <span className="ml-2 text-xs font-normal text-muted">(choose all that apply)</span>}
            </p>
            <ul className="mt-2 space-y-1 text-sm">
              {question.options.map((o) => {
                const right = question.correctOptionIds.includes(o.id);
                return (
                  <li key={o.id} className={right ? "font-medium text-green-800" : "text-muted"}>
                    <span aria-hidden>{right ? "✓ " : "○ "}</span>
                    {o.text}
                    {right && <span className="sr-only"> (correct)</span>}
                  </li>
                );
              })}
            </ul>
            {question.explanation && <p className="mt-2 text-sm text-muted">Why: {question.explanation}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <Button size="sm" variant="ghost" disabled={pending || first} onClick={() => run(url, "PATCH", { move: "up" })} aria-label={`Move question ${index + 1} up`}>
              ↑
            </Button>
            <Button size="sm" variant="ghost" disabled={pending || last} onClick={() => run(url, "PATCH", { move: "down" })} aria-label={`Move question ${index + 1} down`}>
              ↓
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                if (window.confirm(`Delete question ${index + 1}?`)) run(url, "DELETE");
              }}
            >
              Delete
            </Button>
          </div>
        </div>
      )}
      <ErrorText error={error} />
    </div>
  );
}

export function AddQuestion({ quizId }: { quizId: string }) {
  const { pending, error, run } = useApiAction();
  const [open, setOpen] = useState(false);
  // Remount the form after each save so it starts blank.
  const [round, setRound] = useState(0);
  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        + Add a question
      </Button>
    );
  }
  return (
    <div>
      <QuestionForm
        key={round}
        initial={blank}
        submitLabel="Add question"
        pending={pending}
        onSubmit={(d) => run(`/api/admin/quizzes/${quizId}/questions`, "POST", payload(d), () => setRound((r) => r + 1))}
        onCancel={() => setOpen(false)}
      />
      <ErrorText error={error} />
    </div>
  );
}
