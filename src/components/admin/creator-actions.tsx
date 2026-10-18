"use client";

import { useState, type FormEvent } from "react";
import { ErrorText, useApiAction } from "@/components/use-api-action";
import { Button } from "@/components/ui/button";

const field = "mt-1 block w-full rounded-md border border-navy-900/20 bg-white px-3 py-2";

export function DecideApplication({ applicationId }: { applicationId: string }) {
  const { pending, error, run } = useApiAction();
  const [notes, setNotes] = useState("");
  const decide = (decision: "approved" | "rejected") => run(`/api/admin/creators/applications/${applicationId}`, "POST", { decision, notes: notes || null });
  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium">
        Note to the applicant <span className="font-normal text-muted">(sent with the decision; optional)</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={2000} className={field} />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={pending} onClick={() => decide("approved")}>
          Approve
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => decide("rejected")}>
          Decline
        </Button>
      </div>
      <ErrorText error={error} />
    </div>
  );
}

export function GrantFellowForm() {
  const { pending, error, run } = useApiAction();
  const [done, setDone] = useState<string | null>(null);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const email = String(new FormData(form).get("email") ?? "");
    setDone(null);
    run("/api/admin/creators/grant", "POST", { email }, () => {
      setDone(email);
      form.reset();
    });
  }
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <label className="block min-w-64 flex-1 text-sm font-medium">
        Email of an existing account
        <input name="email" type="email" required className={field} placeholder="dad@example.com" />
      </label>
      <Button type="submit" disabled={pending}>
        Make Fellow
      </Button>
      {done && (
        <p role="status" className="w-full text-sm text-emerald-800">
          ✓ {done} can now upload.
        </p>
      )}
      <ErrorText error={error} />
    </form>
  );
}

export function RevokeFellowButton({ userId, name }: { userId: string; name: string }) {
  const { pending, error, run } = useApiAction();
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => {
          if (window.confirm(`Remove ${name}'s upload access? Their published videos stay up.`)) run(`/api/admin/creators/${encodeURIComponent(userId)}`, "DELETE");
        }}
      >
        Remove access
      </Button>
      <ErrorText error={error} />
    </>
  );
}
