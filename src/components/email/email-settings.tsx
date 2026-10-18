"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { EmailCategory } from "@/lib/db/schema";

type Prefs = Record<EmailCategory, boolean>;
type Labels = Record<EmailCategory, { label: string; description: string }>;

async function save(changes: Partial<Prefs>, token?: string): Promise<Prefs> {
  const res = await fetch("/api/email/preferences", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...changes, token }),
  });
  const data = (await res.json().catch(() => ({}))) as { preferences?: Prefs; error?: string };
  if (!res.ok || !data.preferences) throw new Error(data.error === "invalid_link" ? "This link isn't valid any more." : "Couldn't save. Try again.");
  return data.preferences;
}

/** Checkboxes for each optional email category; saves on change. */
export function EmailSettingsForm({ initial, labels, token }: { initial: Prefs; labels: Labels; token?: string }) {
  const [prefs, setPrefs] = useState(initial);
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function change(changes: Partial<Prefs>) {
    const before = prefs;
    // Show the change straight away; put it back if saving fails.
    setPrefs({ ...prefs, ...changes });
    setPending(true);
    setStatus(null);
    try {
      setPrefs(await save(changes, token));
      setStatus({ tone: "ok", text: "Saved." });
    } catch (e) {
      setPrefs(before);
      setStatus({ tone: "error", text: e instanceof Error ? e.message : "Couldn't save." });
    } finally {
      setPending(false);
    }
  }

  const categories = Object.keys(labels) as EmailCategory[];
  const allOff = categories.every((c) => !prefs[c]);
  return (
    <div>
      <fieldset disabled={pending}>
        <legend className="sr-only">Emails you get</legend>
        <ul className="space-y-4">
          {categories.map((c) => (
            <li key={c}>
              <label className="flex cursor-pointer items-start gap-3">
                <input type="checkbox" className="mt-1 h-4 w-4" checked={prefs[c]} onChange={(e) => change({ [c]: e.target.checked })} />
                <span>
                  <span className="block font-medium text-navy-900">{labels[c].label}</span>
                  <span className="block text-sm text-muted">{labels[c].description}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        {!allOff && (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => change({ learning: false, announcements: false, replies: false })}>
            Turn all off
          </Button>
        )}
        <p role="status" className={`text-sm ${status?.tone === "error" ? "text-red-700" : "text-green-800"}`}>
          {status?.text}
        </p>
      </div>
      <p className="mt-4 text-xs text-muted">Emails about your account, payments and gifts are always sent.</p>
    </div>
  );
}

/** The confirm step behind an email's "Unsubscribe" link (a POST, so link scanners can't trigger it). */
export function UnsubscribeButton({ token, category, label }: { token: string; category: EmailCategory; label: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "pending" | "error">("idle");
  async function confirm() {
    setState("pending");
    const res = await fetch(`/api/email/unsubscribe?t=${encodeURIComponent(token)}&c=${category}`, { method: "POST" });
    if (!res.ok) return setState("error");
    router.replace(`/email/unsubscribe?t=${encodeURIComponent(token)}&done=${category}`);
    router.refresh();
  }
  return (
    <div>
      <Button onClick={confirm} disabled={state === "pending"}>
        {state === "pending" ? "Unsubscribing…" : `Unsubscribe from "${label}"`}
      </Button>
      {state === "error" && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          Something went wrong. Try again.
        </p>
      )}
    </div>
  );
}
