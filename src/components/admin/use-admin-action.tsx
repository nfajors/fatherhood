"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

async function call(url: string, method: string, body?: unknown): Promise<string | null> {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.ok) return null;
  const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  return data.message ?? data.error ?? `Request failed (${res.status})`;
}

/** Runs an admin API call, then refreshes the server-rendered page. */
export function useAdminAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (url: string, method: string, body?: unknown, onDone?: () => void) =>
    startTransition(async () => {
      setError(null);
      const failure = await call(url, method, body);
      if (failure) setError(failure);
      else {
        onDone?.();
        router.refresh();
      }
    });
  return { pending, error, run };
}

export function ErrorText({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="mt-2 text-sm text-red-700">
      {error}
    </p>
  ) : null;
}
