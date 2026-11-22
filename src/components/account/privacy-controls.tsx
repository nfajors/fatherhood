"use client";

import { useState, useTransition } from "react";
import { ErrorText } from "@/components/use-api-action";
import { Button } from "@/components/ui/button";

/** Download your data, or delete your account (typing DELETE to confirm). */
export function PrivacyControls() {
  const [confirming, setConfirming] = useState(false);
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <div>
        <Button asChild variant="outline" size="sm">
          <a href="/api/me/export" download>
            Download my data
          </a>
        </Button>
        <p className="mt-1 text-xs text-muted">Everything we hold about you, as a JSON file: progress, ratings, posts, coach conversations, memberships and more.</p>
      </div>
      {!confirming ? (
        <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
          Delete my account
        </Button>
      ) : (
        <form
          className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            start(async () => {
              const res = await fetch("/api/me/account", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmation: text }) });
              if (res.ok) {
                window.location.assign("/?deleted=1");
                return;
              }
              const data = (await res.json().catch(() => ({}))) as { message?: string };
              setError(data.message ?? "Something went wrong. Please try again.");
            });
          }}
        >
          <p className="text-sm">
            This cancels any membership right away (no refund for the rest of the period; ask us if you&apos;re within the money-back guarantee), and deletes your account,
            progress, certificates, posts and coach conversations. It can&apos;t be undone. Receipts stay in our payment records, as the law requires.
          </p>
          <label className="block text-sm font-medium">
            Type DELETE to confirm
            <input value={text} onChange={(e) => setText(e.target.value)} className="mt-1 block w-48 rounded-md border border-navy-900/20 bg-white px-3 py-2" autoComplete="off" />
          </label>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending || text.trim().toUpperCase() !== "DELETE"} className="bg-red-700 text-white hover:bg-red-800">
              {pending ? "Deleting…" : "Delete my account"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
          <ErrorText error={error} />
        </form>
      )}
    </div>
  );
}
