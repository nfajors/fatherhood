"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ErrorText, useApiAction } from "@/components/use-api-action";
import { Button } from "@/components/ui/button";

const field = "mt-1 block w-full rounded-md border border-navy-900/20 bg-white px-3 py-2";

export function CreateCollectionForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const res = await fetch("/api/admin/collections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: new FormData(event.currentTarget).get("title") }),
    });
    const data = (await res.json().catch(() => ({}))) as { collection?: { id: string }; message?: string };
    if (data.collection) router.push(`/admin/collections/${data.collection.id}`);
    else setError(data.message ?? "Could not create the collection.");
  }
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <label className="block min-w-64 flex-1 text-sm font-medium">
        New collection title
        <input name="title" required minLength={2} maxLength={120} placeholder="Start Here" className={field} />
      </label>
      <Button type="submit">Create draft</Button>
      <ErrorText error={error} />
    </form>
  );
}

type Details = { id: string; title: string; slug: string; description: string | null; published: boolean; featured: boolean; sortOrder: number };

export function CollectionDetailsForm({ collection }: { collection: Details }) {
  const { pending, error, run } = useApiAction();
  const [saved, setSaved] = useState(false);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    setSaved(false);
    run(
      `/api/admin/collections/${collection.id}`,
      "PATCH",
      {
        title: String(f.get("title")),
        slug: String(f.get("slug")),
        description: String(f.get("description") ?? ""),
        published: f.get("published") === "on",
        featured: f.get("featured") === "on",
        sortOrder: Number(f.get("sortOrder") || 0),
      },
      () => setSaved(true),
    );
  }
  return (
    <form onSubmit={submit} onChange={() => setSaved(false)} className="grid gap-4 sm:grid-cols-2">
      <label className="block text-sm font-medium">
        Title
        <input name="title" defaultValue={collection.title} required maxLength={120} className={field} />
      </label>
      <label className="block text-sm font-medium">
        Address (/collections/…)
        <input name="slug" defaultValue={collection.slug} required maxLength={60} className={field} />
      </label>
      <label className="block text-sm font-medium sm:col-span-2">
        Description
        <textarea name="description" defaultValue={collection.description ?? ""} rows={2} maxLength={2000} className={field} />
      </label>
      <div className="flex flex-wrap items-center gap-6 text-sm sm:col-span-2">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="published" defaultChecked={collection.published} /> Published
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="featured" defaultChecked={collection.featured} /> Featured on the Academy and Community Voices
        </label>
        <label className="flex items-center gap-2">
          Order
          <input name="sortOrder" type="number" min={0} defaultValue={collection.sortOrder} className="w-20 rounded-md border border-navy-900/20 px-2 py-1" />
        </label>
      </div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={pending}>
          Save
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

type Option = { id: string; title: string; published?: boolean };

export function AddCollectionItemForm({ collectionId, courses, videos }: { collectionId: string; courses: Option[]; videos: Option[] }) {
  const { pending, error, run } = useApiAction();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const f = new FormData(form);
    const [kind, id] = String(f.get("target") ?? "").split(":");
    if (!id) return;
    run(
      `/api/admin/collections/${collectionId}/items`,
      "POST",
      { ...(kind === "course" ? { courseId: id } : { videoId: id }), note: String(f.get("note") ?? "") || null },
      () => form.reset(),
    );
  }
  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
      <label className="block text-sm font-medium">
        Course or video
        <select name="target" required defaultValue="" className={field}>
          <option value="" disabled>
            Choose…
          </option>
          <optgroup label="Courses">
            {courses.map((c) => (
              <option key={c.id} value={`course:${c.id}`}>
                {c.title}
                {c.published ? "" : " (draft)"}
              </option>
            ))}
          </optgroup>
          <optgroup label="Community videos">
            {videos.map((v) => (
              <option key={v.id} value={`video:${v.id}`}>
                {v.title}
              </option>
            ))}
          </optgroup>
        </select>
      </label>
      <label className="block text-sm font-medium">
        Note <span className="font-normal text-muted">(optional, shown with it)</span>
        <input name="note" maxLength={500} placeholder="Why it's here" className={field} />
      </label>
      <div className="sm:col-span-2">
        <Button type="submit" size="sm" disabled={pending}>
          Add to collection
        </Button>
        <ErrorText error={error} />
      </div>
    </form>
  );
}

export function CollectionItemRow({
  item,
  first,
  last,
}: {
  item: { id: string; label: string; kind: "Course" | "Video"; note: string | null; warning: string | null };
  first: boolean;
  last: boolean;
}) {
  const { pending, error, run } = useApiAction();
  const [editing, setEditing] = useState(false);
  const url = `/api/admin/collections/items/${item.id}`;
  return (
    <li className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          <span className="mr-2 rounded bg-navy-100 px-1.5 py-0.5 text-xs">{item.kind}</span>
          {item.label}
        </p>
        {item.warning && <p className="text-sm text-amber-800">{item.warning}</p>}
        {editing ? (
          <form
            className="mt-2 flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(url, "PATCH", { note: String(new FormData(e.currentTarget).get("note") ?? "") || null }, () => setEditing(false));
            }}
          >
            <input name="note" defaultValue={item.note ?? ""} maxLength={500} aria-label="Note" className="min-w-64 flex-1 rounded-md border border-navy-900/20 px-2 py-1 text-sm" />
            <Button size="sm" type="submit" disabled={pending}>
              Save
            </Button>
            <Button size="sm" type="button" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </form>
        ) : (
          item.note && <p className="mt-1 text-sm text-muted">{item.note}</p>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        <Button size="sm" variant="ghost" disabled={pending || first} onClick={() => run(url, "PATCH", { move: "up" })} aria-label={`Move ${item.label} up`}>
          ↑
        </Button>
        <Button size="sm" variant="ghost" disabled={pending || last} onClick={() => run(url, "PATCH", { move: "down" })} aria-label={`Move ${item.label} down`}>
          ↓
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
          Note
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(url, "DELETE")}>
          Remove
        </Button>
      </div>
      <ErrorText error={error} />
    </li>
  );
}

export function DeleteCollectionButton({ collectionId, title }: { collectionId: string; title: string }) {
  const router = useRouter();
  const { pending, error, run } = useApiAction();
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="text-red-700"
        disabled={pending}
        onClick={() => {
          if (window.confirm(`Delete the collection "${title}"? The courses and videos in it are kept.`)) {
            run(`/api/admin/collections/${collectionId}`, "DELETE", undefined, () => router.push("/admin/collections"));
          }
        }}
      >
        Delete collection
      </Button>
      <ErrorText error={error} />
    </>
  );
}
