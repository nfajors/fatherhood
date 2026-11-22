"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { ErrorText, useApiAction } from "@/components/use-api-action";
import { Button } from "@/components/ui/button";
import { COACH_STAGES, type CoachStage } from "@/lib/coach/policy";

const field = "mt-1 block w-full rounded-md border border-navy-900/20 bg-white px-3 py-2";

/** What the member tells the coach about himself. Saving also (re)plans his path. */
export function ProfileForm({ initial }: { initial: { stage: CoachStage; children: string | null; goals: string | null } | null }) {
  const router = useRouter();
  const [stage, setStage] = useState<CoachStage | "">(initial?.stage ?? "");
  const [children, setChildren] = useState(initial?.children ?? "");
  const [goals, setGoals] = useState(initial?.goals ?? "");
  const [pending, startTransition] = useTransition();
  const [step, setStep] = useState<"idle" | "saving" | "planning">("idle");
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!stage) return;
    setError(null);
    startTransition(async () => {
      setStep("saving");
      const saved = await fetch("/api/coach/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage, children, goals }),
      });
      if (!saved.ok) {
        const data = (await saved.json().catch(() => ({}))) as { message?: string };
        setError(data.message ?? "Couldn't save that. Please try again.");
        setStep("idle");
        return;
      }
      setStep("planning");
      const planned = await fetch("/api/coach/path", { method: "POST" });
      if (!planned.ok) {
        const data = (await planned.json().catch(() => ({}))) as { message?: string };
        setError(`Saved. ${data.message ?? "Your path couldn't be planned just now; try again in a moment."}`);
      }
      setStep("idle");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <label className="block text-sm font-medium">
        Where you are
        <select value={stage} onChange={(e) => setStage(e.target.value as CoachStage)} required className={field}>
          <option value="" disabled>
            Choose one
          </option>
          {Object.entries(COACH_STAGES).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm font-medium">
        Your children <span className="font-normal text-muted">(optional)</span>
        <input value={children} onChange={(e) => setChildren(e.target.value)} maxLength={300} className={field} placeholder="A son, 4, and a daughter, 9 months" />
      </label>
      <label className="block text-sm font-medium">
        What you want to work on <span className="font-normal text-muted">(optional, in your own words)</span>
        <textarea
          value={goals}
          onChange={(e) => setGoals(e.target.value)}
          maxLength={1000}
          rows={4}
          className={field}
          placeholder="Being more patient at bedtime. Staying close to my kids while I co-parent across two homes."
        />
      </label>
      <p className="text-xs text-muted">Only you and the coach see this. Change or clear it any time.</p>
      <Button type="submit" disabled={pending || !stage}>
        {step === "saving" ? "Saving…" : step === "planning" ? "Planning your path…" : initial ? "Save and update my path" : "Save and plan my path"}
      </Button>
      {step === "planning" && (
        <p className="text-sm text-muted" aria-live="polite">
          The coach is choosing lessons and stories for you. This takes about half a minute.
        </p>
      )}
      <ErrorText error={error} />
    </form>
  );
}

export function ReplanButton() {
  const { pending, error, run } = useApiAction();
  return (
    <div>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run("/api/coach/path", "POST")}>
        {pending ? "Planning…" : "Plan again"}
      </Button>
      <ErrorText error={error} />
    </div>
  );
}

export function DeleteConversationButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() => {
        if (!window.confirm("Delete this conversation? It can't be undone.")) return;
        startTransition(async () => {
          const res = await fetch(`/api/coach/conversations/${id}`, { method: "DELETE" });
          if (res.ok) {
            router.push("/coach");
            router.refresh();
          }
        });
      }}
    >
      Delete conversation
    </Button>
  );
}
