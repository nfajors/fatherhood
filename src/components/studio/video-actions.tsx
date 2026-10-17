"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState, type ChangeEvent, type FormEvent } from "react";
import { ErrorText, useApiAction } from "@/components/use-api-action";
import { Button } from "@/components/ui/button";
import { CATEGORIES } from "@/lib/config";
import type { VideoType } from "@/lib/db/schema";
import { checkFile, UploadProgress, useResumableUpload } from "./resumable-upload";
import { field, parseTags } from "./upload-form";

type Details = { id: string; title: string; description: string | null; category: string | null; tags: string[] };

export function EditDetailsForm({ video }: { video: Details }) {
  const { pending, error, run } = useApiAction();
  const [saved, setSaved] = useState(false);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    setSaved(false);
    run(
      `/api/studio/videos/${video.id}`,
      "PATCH",
      {
        title: String(f.get("title") ?? ""),
        description: String(f.get("description") ?? ""),
        category: String(f.get("category") ?? "") || null,
        tags: parseTags(String(f.get("tags") ?? "")),
      },
      () => setSaved(true),
    );
  }
  return (
    <form onSubmit={submit} onChange={() => setSaved(false)} className="space-y-4">
      <label className="block text-sm font-medium">
        Title
        <input name="title" defaultValue={video.title} required minLength={3} maxLength={140} className={field} />
      </label>
      <label className="block text-sm font-medium">
        Description
        <textarea name="description" defaultValue={video.description ?? ""} rows={4} maxLength={5000} className={field} />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          Category
          <select name="category" defaultValue={video.category ?? ""} className={field}>
            <option value="">None</option>
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium">
          Tags <span className="font-normal text-muted">(comma separated)</span>
          <input name="tags" defaultValue={video.tags.join(", ")} className={field} />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" variant="outline" disabled={pending}>
          Save details
        </Button>
        {saved && (
          <span role="status" className="text-sm text-emerald-800">
            ✓ Saved
          </span>
        )}
      </div>
      <ErrorText error={error} />
    </form>
  );
}

export function ResubmitForm({ videoId }: { videoId: string }) {
  const { pending, error, run } = useApiAction();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    run(`/api/studio/videos/${videoId}/resubmit`, "POST", { note: String(new FormData(event.currentTarget).get("note") ?? "") || null });
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block text-sm font-medium">
        Note to the reviewer <span className="font-normal text-muted">(optional)</span>
        <textarea name="note" rows={2} maxLength={1000} className={field} placeholder="What you changed" />
      </label>
      <Button type="submit" disabled={pending}>
        Resubmit for review
      </Button>
      <ErrorText error={error} />
    </form>
  );
}

const REPLACE_COPY = {
  uploading: { title: "Upload the video file", detail: "If an upload stopped, choose the same file again: it resumes where it left off.", button: "Upload" },
  changes_requested: {
    title: "Upload a new version",
    detail: "The new file replaces the current one and goes back for review. Your title and description stay.",
    button: "Upload new version",
  },
  failed: { title: "Try the upload again", detail: "Cloudflare couldn't process the last file. A fresh export usually fixes it.", button: "Upload again" },
} as const;

export function ReplaceFile({ videoId, type, status }: { videoId: string; type: VideoType; status: keyof typeof REPLACE_COPY }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const onDone = useCallback(() => router.refresh(), [router]);
  const { state, start, pause, resume } = useResumableUpload(onDone);
  const copy = REPLACE_COPY[status];

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0] ?? null;
    setFile(chosen);
    setProblem(chosen ? await checkFile(chosen, type) : null);
  }

  return (
    <div className="space-y-3">
      <h3 className="font-semibold">{copy.title}</h3>
      <p className="text-sm text-muted">{copy.detail}</p>
      <div className="flex flex-wrap items-end gap-3">
        <input
          type="file"
          accept="video/*"
          aria-label="Video file"
          disabled={state.phase !== "idle"}
          onChange={choose}
          className={`${field} max-w-md file:mr-3 file:rounded file:border-0 file:bg-navy-100 file:px-3 file:py-1`}
        />
        {state.phase === "idle" && (
          <Button type="button" disabled={!file || Boolean(problem)} onClick={() => file && start(videoId, file)}>
            {copy.button}
          </Button>
        )}
      </div>
      {problem && (
        <p role="alert" className="text-sm text-red-700">
          {problem}
        </p>
      )}
      <UploadProgress state={state} onPause={pause} onResume={resume} />
    </div>
  );
}

export function DeleteVideoButton({ videoId, title }: { videoId: string; title: string }) {
  const router = useRouter();
  const { pending, error, run } = useApiAction();
  return (
    <div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="border-red-200 text-red-700 hover:bg-red-50"
        disabled={pending}
        onClick={() => {
          if (window.confirm(`Delete "${title}"? This can't be undone.`)) run(`/api/studio/videos/${videoId}`, "DELETE", undefined, () => router.push("/studio"));
        }}
      >
        Delete video
      </Button>
      <ErrorText error={error} />
    </div>
  );
}
