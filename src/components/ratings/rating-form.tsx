"use client";

import { useState, type FormEvent } from "react";
import { ErrorText, useApiAction } from "@/components/use-api-action";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const LABELS = ["", "Poor", "Fair", "Good", "Very good", "Excellent"];

/** Pick 1-5 stars and optionally write a review. The server decides whether this viewer may rate. */
export function RatingForm({
  videoId,
  current,
  hint,
  maxChars,
}: {
  videoId: string;
  current: { stars: number; review: string | null; reviewHidden: boolean } | null;
  /** Why rating may not work yet (e.g. "watch a little first"); the form still submits. */
  hint?: string | null;
  maxChars: number;
}) {
  const { pending, error, run } = useApiAction();
  const [stars, setStars] = useState(current?.stars ?? 0);
  const [hover, setHover] = useState(0);
  const [review, setReview] = useState(current?.review ?? "");
  const [saved, setSaved] = useState(false);
  const shown = hover || stars;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stars) return;
    setSaved(false);
    run(`/api/videos/${videoId}/rating`, "PUT", { stars, review: review.trim() || null }, () => setSaved(true));
  }

  return (
    <form onSubmit={submit} onChange={() => setSaved(false)} className="space-y-3">
      <fieldset>
        <legend className="text-sm font-medium">{current ? "Your rating" : "Rate this video"}</legend>
        <div className="mt-1 flex items-center gap-3">
          <div className="flex" onMouseLeave={() => setHover(0)}>
            {[1, 2, 3, 4, 5].map((n) => (
              <label key={n} className="cursor-pointer p-0.5 text-3xl leading-none" onMouseEnter={() => setHover(n)}>
                <input
                  type="radio"
                  name="stars"
                  value={n}
                  checked={stars === n}
                  onChange={() => setStars(n)}
                  className="peer sr-only"
                  aria-label={`${n} ${n === 1 ? "star" : "stars"}: ${LABELS[n]}`}
                />
                <span aria-hidden className={cn("rounded peer-focus-visible:ring-2 peer-focus-visible:ring-navy-900", n <= shown ? "text-gold-600" : "text-navy-900/20")}>
                  ★
                </span>
              </label>
            ))}
          </div>
          <span className="text-sm text-muted" aria-live="polite">
            {shown ? LABELS[shown] : ""}
          </span>
        </div>
      </fieldset>
      <label className="block text-sm font-medium">
        Review <span className="font-normal text-muted">(optional)</span>
        <textarea
          value={review}
          onChange={(e) => setReview(e.target.value)}
          rows={3}
          maxLength={maxChars}
          placeholder="What did you take from it? Reviews show your first name and last initial."
          className="mt-1 block w-full rounded-md border border-navy-900/20 bg-white px-3 py-2 font-normal"
        />
      </label>
      {current?.reviewHidden && <p className="text-xs text-muted">Your written review was hidden by our moderators. Your stars still count.</p>}
      {hint && <p className="text-sm text-muted">{hint}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={pending || !stars}>
          {current ? "Update rating" : "Submit rating"}
        </Button>
        {current && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              setStars(0);
              setReview("");
              run(`/api/videos/${videoId}/rating`, "DELETE");
            }}
          >
            Remove
          </Button>
        )}
        {saved && (
          <span role="status" className="text-sm text-emerald-800">
            ✓ Thanks for rating
          </span>
        )}
      </div>
      <ErrorText error={error} />
    </form>
  );
}
