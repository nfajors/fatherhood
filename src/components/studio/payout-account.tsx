"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/** POSTs to a Studio payouts endpoint and follows the Stripe link it returns. */
export function StripeLinkButton({ endpoint, label, variant = "primary" }: { endpoint: string; label: string; variant?: "primary" | "outline" }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    setPending(true);
    setError(null);
    const res = await fetch(endpoint, { method: "POST" });
    const data = (await res.json().catch(() => ({}))) as { url?: string; message?: string };
    if (res.ok && data.url) {
      window.location.assign(data.url);
      return;
    }
    setError(data.message ?? "Couldn't reach Stripe. Try again in a minute.");
    setPending(false);
  }
  return (
    <div>
      <Button variant={variant} size="sm" disabled={pending} onClick={go}>
        {pending ? "Opening Stripe…" : label}
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
