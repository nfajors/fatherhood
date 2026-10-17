"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { REPORT_REASONS, type ReportReason } from "@/lib/moderation/policy";

/** "Report this video" for signed-in viewers; signed-out viewers are asked to sign in. */
export function ReportButton({ videoId, signedIn, returnTo }: { videoId: string; signedIn: boolean; returnTo: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  if (!signedIn) {
    return (
      <Link href={`/sign-in?next=${encodeURIComponent(returnTo)}`} className="text-sm text-muted underline underline-offset-4">
        Sign in to report this video
      </Link>
    );
  }
  if (state === "sent") return <p className="text-sm text-muted">Thanks. Our moderators will take a look.</p>;
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-sm text-muted underline underline-offset-4">
        Report this video
      </button>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setState("sending");
    const res = await fetch(`/api/videos/${videoId}/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: form.get("reason"), details: String(form.get("details") ?? "").trim() || undefined }),
    });
    setState(res.ok ? "sent" : "error");
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-navy-900/10 bg-white p-4">
      <fieldset>
        <legend className="text-sm font-semibold">What&apos;s wrong with this video?</legend>
        <div className="mt-2 space-y-1">
          {(Object.entries(REPORT_REASONS) as [ReportReason, string][]).map(([value, label], i) => (
            <label key={value} className="flex items-center gap-2 text-sm">
              <input type="radio" name="reason" value={value} required defaultChecked={i === 0} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block text-sm">
        Anything we should know? (optional)
        <textarea name="details" rows={3} maxLength={1000} className="mt-1 block w-full rounded-md border border-navy-900/20 px-3 py-2" />
      </label>
      {state === "error" && (
        <p role="alert" className="text-sm text-red-700">
          The report didn&apos;t go through. Please try again.
        </p>
      )}
      <div className="flex gap-2">
        <Button size="sm" type="submit" disabled={state === "sending"}>
          Send report
        </Button>
        <Button size="sm" variant="ghost" type="button" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
