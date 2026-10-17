"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";

async function call(url: string, method: string, body?: unknown): Promise<string | null> {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.ok) return null;
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error ?? `Request failed (${res.status})`;
}

/** Runs an admin API call, then refreshes the server-rendered page. */
function useAdminAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (url: string, method: string, body?: unknown) =>
    startTransition(async () => {
      setError(null);
      const failure = await call(url, method, body);
      if (failure) setError(failure);
      else router.refresh();
    });
  return { pending, error, run };
}

function ErrorText({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="mt-2 text-sm text-red-700">
      {error}
    </p>
  ) : null;
}

export function ThemeStatusButtons({
  themeId,
  status,
  mergeTargets,
}: {
  themeId: string;
  status: "proposed" | "active" | "archived";
  mergeTargets: { id: string; name: string }[];
}) {
  const { pending, error, run } = useAdminAction();
  const [target, setTarget] = useState("");
  const url = `/api/admin/themes/${themeId}`;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {status !== "active" && (
          <Button size="sm" disabled={pending} onClick={() => run(url, "PATCH", { status: "active" })}>
            {status === "proposed" ? "Approve" : "Restore"}
          </Button>
        )}
        {status !== "archived" && (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => run(url, "PATCH", { status: "archived" })}>
            Archive
          </Button>
        )}
        {status !== "archived" && mergeTargets.length > 0 && (
          <span className="flex items-center gap-2">
            <label className="sr-only" htmlFor={`merge-${themeId}`}>
              Merge into
            </label>
            <select
              id={`merge-${themeId}`}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="h-9 rounded-md border border-navy-900/20 bg-white px-2 text-sm"
            >
              <option value="">Merge into...</option>
              {mergeTargets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="secondary"
              disabled={pending || !target}
              onClick={() => run(`${url}/merge`, "POST", { intoThemeId: target })}
            >
              Merge
            </Button>
          </span>
        )}
      </div>
      <ErrorText error={error} />
    </div>
  );
}

export function ThemeEditForm({ themeId, name, description }: { themeId: string; name: string; description: string }) {
  const { pending, error, run } = useAdminAction();
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Edit
      </Button>
    );
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    run(`/api/admin/themes/${themeId}`, "PATCH", { name: form.get("name"), description: form.get("description") });
    setOpen(false);
  }
  return (
    <form onSubmit={submit} className="mt-3 space-y-2">
      <input name="name" defaultValue={name} required minLength={2} className="block w-full rounded-md border border-navy-900/20 px-3 py-2" />
      <textarea
        name="description"
        defaultValue={description}
        required
        minLength={10}
        rows={3}
        className="block w-full rounded-md border border-navy-900/20 px-3 py-2"
      />
      <div className="flex gap-2">
        <Button size="sm" type="submit" disabled={pending}>
          Save
        </Button>
        <Button size="sm" variant="ghost" type="button" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      <ErrorText error={error} />
    </form>
  );
}

export function NewThemeForm() {
  const { pending, error, run } = useAdminAction();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    run("/api/admin/themes", "POST", { name: form.get("name"), description: form.get("description") });
    formEl.reset();
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block text-sm font-medium">
        Name
        <input name="name" required minLength={2} maxLength={80} className="mt-1 block w-full rounded-md border border-navy-900/20 px-3 py-2" />
      </label>
      <label className="block text-sm font-medium">
        What belongs in it (the AI reads this)
        <textarea name="description" required minLength={10} maxLength={600} rows={3} className="mt-1 block w-full rounded-md border border-navy-900/20 px-3 py-2" />
      </label>
      <Button type="submit" disabled={pending}>
        Add theme
      </Button>
      <ErrorText error={error} />
    </form>
  );
}

export function ClassifyButton({ target, label = "Run AI" }: { target?: { kind: "video" | "course"; id: string }; label?: string }) {
  const { pending, error, run } = useAdminAction();
  return (
    <span>
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => run("/api/admin/themes/classify", "POST", target ?? { pending: true, limit: 10 })}
      >
        {pending ? "Classifying..." : label}
      </Button>
      <ErrorText error={error} />
    </span>
  );
}

export function RemovePlacementButton({ themeId, target }: { themeId: string; target: { kind: "video" | "course"; id: string } }) {
  const { pending, error, run } = useAdminAction();
  return (
    <span>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(`/api/admin/themes/${themeId}/content`, "DELETE", target)}>
        Remove
      </Button>
      <ErrorText error={error} />
    </span>
  );
}

export function RestorePlacementButton({ themeId, target }: { themeId: string; target: { kind: "video" | "course"; id: string } }) {
  const { pending, error, run } = useAdminAction();
  return (
    <span>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(`/api/admin/themes/${themeId}/content`, "PUT", target)}>
        Put back
      </Button>
      <ErrorText error={error} />
    </span>
  );
}
