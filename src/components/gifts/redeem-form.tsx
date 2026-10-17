"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";

type Result =
  | { kind: "access"; accessUntil: string }
  | { kind: "billing_credit"; creditCents: number };

const formatDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { dateStyle: "long" });

export function RedeemForm({ initialCode }: { initialCode?: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("code") ?? "");
    setPending(true);
    setError(null);
    const res = await fetch("/api/gifts/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const data = (await res.json().catch(() => ({}))) as Result & { message?: string };
    setPending(false);
    if (!res.ok) {
      setError(data.message ?? "Something went wrong. Please try again.");
      return;
    }
    setResult(data);
  }

  if (result) {
    return (
      <div role="status" className="rounded-xl border-2 border-gold-500 bg-white p-6">
        <h2 className="text-2xl font-semibold">Your gift is on your account</h2>
        <p className="mt-3 text-ink">
          {result.kind === "access"
            ? `Your membership runs until ${formatDate(result.accessUntil)}.`
            : `You already have a membership, so we added $${(result.creditCents / 100).toFixed(2)} of credit to your billing account. It pays for your upcoming renewals automatically.`}
        </p>
        <Button asChild className="mt-6">
          <Link href="/academy">Start learning</Link>
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block text-sm font-medium">
        Gift code
        <input
          name="code"
          required
          defaultValue={initialCode}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="FATHER-XXXX-XXXX"
          className="mt-1 block w-full rounded-md border border-navy-900/20 bg-white px-3 py-2.5 font-mono text-lg uppercase tracking-wider text-ink"
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Redeeming..." : "Redeem gift"}
      </Button>
    </form>
  );
}
