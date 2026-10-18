"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/** "Helpful" toggle on a review. Signed-out viewers are sent to sign in. */
export function HelpfulButton({ ratingId, initialCount, initialVoted, signedIn }: { ratingId: string; initialCount: number; initialVoted: boolean; signedIn: boolean }) {
  const [state, setState] = useState({ count: initialCount, voted: initialVoted });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (!signedIn) {
      window.location.href = `/sign-in?next=${encodeURIComponent(window.location.pathname)}`;
      return;
    }
    setPending(true);
    setError(null);
    const res = await fetch(`/api/reviews/${ratingId}/helpful`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ helpful: !state.voted }),
    });
    const data = (await res.json().catch(() => ({}))) as { helpful?: boolean; helpfulCount?: number; message?: string };
    setPending(false);
    if (res.ok && data.helpfulCount !== undefined) setState({ count: data.helpfulCount, voted: Boolean(data.helpful) });
    else setError(data.message ?? "Couldn't save your vote.");
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={state.voted}
        className={cn(
          "rounded-full border px-3 py-1 text-xs font-medium",
          state.voted ? "border-navy-900 bg-navy-900 text-white" : "border-navy-900/20 text-navy-900 hover:bg-navy-100",
        )}
      >
        {state.voted ? "✓ Helpful" : "Helpful"}
        {state.count > 0 && <span className="ml-1 tabular-nums">· {state.count}</span>}
      </button>
      {error && (
        <span role="alert" className="text-xs text-red-700">
          {error}
        </span>
      )}
    </span>
  );
}
