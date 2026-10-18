"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ErrorText, useApiAction } from "@/components/use-api-action";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/format";

const field = "mt-1 block w-full rounded-md border border-navy-900/20 bg-white px-3 py-2";

const KINDS = [
  ["workbook", "Workbook"],
  ["pdf", "PDF"],
  ["insight_card", "Insight card"],
  ["other", "Other"],
] as const;
const KIND_LABEL = Object.fromEntries(KINDS) as Record<string, string>;
const ACCEPT = ".pdf,.docx,.xlsx,.pptx,.png,.jpg,.jpeg";

export type ResourceRow = { id: string; title: string; kind: string; fileName: string; sizeBytes: number };

/** PUT the file to the presigned URL, reporting progress (fetch can't report upload progress). */
function putFile(url: string, file: File, contentType: string, onProgress: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error("The upload was interrupted. Check your connection and try again."));
    xhr.send(file);
  });
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T & { message?: string; error?: string };
  if (!res.ok) throw new Error(data.message ?? data.error ?? `Request failed (${res.status})`);
  return data;
}

function AddResourceForm({ lessonId, onDone }: { lessonId: string; onDone: () => void }) {
  const router = useRouter();
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const f = new FormData(form);
    const file = f.get("file") as File | null;
    if (!file || !file.size) return;
    setError(null);
    setProgress(0);
    try {
      const contentType = file.type || "application/octet-stream";
      const base = `/api/admin/courses/lessons/${lessonId}/resources`;
      const prepared = await postJson<{ key: string; uploadUrl: string }>(`${base}/upload-url`, { fileName: file.name, contentType, size: file.size });
      await putFile(prepared.uploadUrl, file, contentType, setProgress);
      await postJson(base, { key: prepared.key, title: String(f.get("title") ?? ""), kind: String(f.get("kind")) });
      form.reset();
      onDone();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setProgress(null);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 grid gap-3 rounded-md border border-navy-900/10 bg-paper p-3 sm:grid-cols-[1fr_10rem]">
      <label className="block text-sm font-medium">
        Title
        <input name="title" required minLength={2} maxLength={140} className={field} placeholder="Reflection workbook" />
      </label>
      <label className="block text-sm font-medium">
        Kind
        <select name="kind" defaultValue="workbook" className={field}>
          {KINDS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm font-medium sm:col-span-2">
        File <span className="font-normal text-muted">(PDF, Word, Excel, PowerPoint, PNG or JPEG; up to 50 MB)</span>
        <input name="file" type="file" required accept={ACCEPT} className={`${field} file:mr-3 file:rounded file:border-0 file:bg-navy-100 file:px-3 file:py-1`} />
      </label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button type="submit" size="sm" disabled={progress !== null}>
          {progress === null ? "Upload" : `Uploading… ${Math.round(progress * 100)}%`}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone} disabled={progress !== null}>
          Cancel
        </Button>
        <ErrorText error={error} />
      </div>
    </form>
  );
}

function ResourceItem({ resource, first, last }: { resource: ResourceRow; first: boolean; last: boolean }) {
  const { pending, error, run } = useApiAction();
  const [renaming, setRenaming] = useState(false);
  const url = `/api/admin/courses/resources/${resource.id}`;

  if (renaming) {
    return (
      <li className="py-2">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            run(url, "PATCH", { title: String(f.get("title")), kind: String(f.get("kind")) }, () => setRenaming(false));
          }}
        >
          <input name="title" defaultValue={resource.title} required minLength={2} maxLength={140} aria-label="Title" className="min-w-48 flex-1 rounded-md border border-navy-900/20 px-2 py-1 text-sm" />
          <select name="kind" defaultValue={resource.kind} aria-label="Kind" className="rounded-md border border-navy-900/20 px-2 py-1 text-sm">
            {KINDS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <Button size="sm" type="submit" disabled={pending}>
            Save
          </Button>
          <Button size="sm" type="button" variant="ghost" onClick={() => setRenaming(false)}>
            Cancel
          </Button>
        </form>
        <ErrorText error={error} />
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center gap-2 py-2 text-sm">
      <span aria-hidden>📄</span>
      <span className="min-w-0 flex-1">
        <a href={`/api/resources/${resource.id}/download`} className="font-medium underline-offset-2 hover:underline">
          {resource.title}
        </a>
        <span className="ml-2 text-xs text-muted">
          {KIND_LABEL[resource.kind] ?? resource.kind} · {resource.fileName} · {formatBytes(resource.sizeBytes)}
        </span>
      </span>
      <Button size="sm" variant="ghost" disabled={pending || first} onClick={() => run(url, "PATCH", { move: "up" })} aria-label={`Move ${resource.title} up`}>
        ↑
      </Button>
      <Button size="sm" variant="ghost" disabled={pending || last} onClick={() => run(url, "PATCH", { move: "down" })} aria-label={`Move ${resource.title} down`}>
        ↓
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setRenaming(true)}>
        Rename
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => {
          if (window.confirm(`Delete the download "${resource.title}"?`)) run(url, "DELETE");
        }}
      >
        Delete
      </Button>
      <ErrorText error={error} />
    </li>
  );
}

/** A lesson's downloads in the course builder. */
export function LessonResources({ lessonId, resources }: { lessonId: string; resources: ResourceRow[] }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="px-4 pb-4">
      {resources.length > 0 && (
        <ul className="divide-y divide-navy-900/5 border-l-2 border-gold-100 pl-3" aria-label="Downloads">
          {resources.map((r, i) => (
            <ResourceItem key={r.id} resource={r} first={i === 0} last={i === resources.length - 1} />
          ))}
        </ul>
      )}
      {adding ? (
        <AddResourceForm lessonId={lessonId} onDone={() => setAdding(false)} />
      ) : (
        <Button size="sm" variant="ghost" className="mt-1 text-xs" onClick={() => setAdding(true)}>
          + Add download
        </Button>
      )}
    </div>
  );
}
