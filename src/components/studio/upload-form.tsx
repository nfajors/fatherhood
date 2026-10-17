"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState, type ChangeEvent, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { CATEGORIES } from "@/lib/config";
import type { VideoType } from "@/lib/db/schema";
import { checkFile, UploadProgress, useResumableUpload } from "./resumable-upload";
import { formatBytes } from "./upload-checks";

export const field = "mt-1 block w-full rounded-md border border-navy-900/20 bg-white px-3 py-2";

/** "work, nights , Bedtime" -> ["work", "nights", "bedtime"] */
export const parseTags = (value: string) =>
  [...new Set(value.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 10);

/** A title suggestion from the file name: "bedtime_call-final.mov" -> "Bedtime call final". */
const titleFromFile = (name: string) => {
  const base = name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  return base ? base[0]!.toUpperCase() + base.slice(1) : "";
};

/** New video: choose the file, describe it, upload. */
export function UploadForm({ canUploadLessons }: { canUploadLessons: boolean }) {
  const router = useRouter();
  const [type, setType] = useState<VideoType>("community");
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const onDone = useCallback((videoId: string) => router.push(`/studio/videos/${videoId}?uploaded=1`), [router]);
  const { state, start, pause, resume } = useResumableUpload(onDone);

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0] ?? null;
    setFile(chosen);
    setProblem(null);
    if (!chosen) return;
    setChecking(true);
    setProblem(await checkFile(chosen, type));
    setChecking(false);
    if (!title) setTitle(titleFromFile(chosen.name));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || problem || submitting) return;
    setError(null);
    setSubmitting(true);
    const f = new FormData(event.currentTarget);
    const res = await fetch("/api/studio/videos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type,
        title,
        description: String(f.get("description") ?? ""),
        category: String(f.get("category") ?? "") || null,
        tags: parseTags(String(f.get("tags") ?? "")),
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { video?: { id: string }; message?: string };
    if (!data.video) {
      setSubmitting(false);
      setError(data.message ?? "Couldn't start the upload. Try again.");
      return;
    }
    await start(data.video.id, file);
  }

  const locked = state.phase !== "idle" || submitting;
  return (
    <form onSubmit={submit} className="space-y-5">
      {canUploadLessons && (
        <fieldset disabled={locked}>
          <legend className="text-sm font-medium">Type</legend>
          <div className="mt-2 flex flex-wrap gap-4 text-sm">
            {(
              [
                ["community", "Community Voices (up to 8 minutes, free to watch)"],
                ["professional", "Academy lesson (members only)"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="type"
                  value={value}
                  checked={type === value}
                  onChange={() => {
                    setType(value);
                    setFile(null);
                    setProblem(null);
                  }}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <label className="block text-sm font-medium">
        Video file
        <input type="file" accept="video/*" required disabled={locked} onChange={choose} className={`${field} file:mr-3 file:rounded file:border-0 file:bg-navy-100 file:px-3 file:py-1`} />
        <span className="mt-1 block text-xs font-normal text-muted">
          {type === "community" ? "Up to 8 minutes. Film in landscape if you can; phone video is fine." : "Lessons can run up to 2 hours."}
        </span>
      </label>
      {checking && <p className="text-sm text-muted">Checking the file…</p>}
      {file && !checking && !problem && (
        <p className="text-sm text-muted">
          {file.name} · {formatBytes(file.size)}
        </p>
      )}
      {problem && (
        <p role="alert" className="text-sm text-red-700">
          {problem}
        </p>
      )}

      <fieldset disabled={locked} className="space-y-5">
        <label className="block text-sm font-medium">
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} required minLength={3} maxLength={140} className={field} />
        </label>
        <label className="block text-sm font-medium">
          Description <span className="font-normal text-muted">(optional)</span>
          <textarea name="description" rows={4} maxLength={5000} className={field} placeholder="What should a father take away from this?" />
        </label>
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="block text-sm font-medium">
            Category <span className="font-normal text-muted">(optional)</span>
            <select name="category" defaultValue="" className={field}>
              <option value="">Choose one</option>
              {CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium">
            Tags <span className="font-normal text-muted">(optional, comma separated)</span>
            <input name="tags" className={field} placeholder="night shifts, bedtime" />
          </label>
        </div>
      </fieldset>

      <p className="text-xs text-muted">
        Our standard Fatherhood.School watermark is added automatically. Every video is reviewed before it&apos;s published; by uploading you
        confirm you have the right to share it.
      </p>

      {state.phase === "idle" ? (
        <Button type="submit" disabled={!file || checking || Boolean(problem) || submitting}>
          Upload video
        </Button>
      ) : (
        <UploadProgress state={state} onPause={pause} onResume={resume} />
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </form>
  );
}
