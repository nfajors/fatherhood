"use client";

import { useState, type FormEvent } from "react";
import { ErrorText, useApiAction } from "@/components/use-api-action";
import { Button } from "@/components/ui/button";

const field = "mt-1 block w-full rounded-md border border-navy-900/20 bg-white px-3 py-2";

export function ApplyForm() {
  const { pending, error, run } = useApiAction();
  const [length, setLength] = useState(0);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    run("/api/fellows/apply", "POST", { statement: String(f.get("statement") ?? ""), sampleUrl: String(f.get("sampleUrl") ?? "") });
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block text-sm font-medium">
        Tell us about yourself as a father, and what you&apos;d share
        <textarea
          name="statement"
          required
          minLength={40}
          maxLength={3000}
          rows={6}
          className={field}
          onChange={(e) => setLength(e.target.value.trim().length)}
          placeholder="Your kids' ages, what you've learned the hard way, the stories you'd tell another dad…"
        />
        <span className="mt-1 block text-xs font-normal text-muted">{length < 40 ? `At least 40 characters (${length} so far)` : `${length} characters`}</span>
      </label>
      <label className="block text-sm font-medium">
        Link to a sample <span className="font-normal text-muted">(optional: a video, podcast, or writing of yours)</span>
        <input name="sampleUrl" type="url" maxLength={500} className={field} placeholder="https://" />
      </label>
      <Button type="submit" disabled={pending}>
        Apply to be a Fellow
      </Button>
      <ErrorText error={error} />
    </form>
  );
}
