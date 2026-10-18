"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/** Send the previewed email to the signed-in admin. */
export function SendTestEmail({ sequence, step, variant }: { sequence: string; step: string; variant: string }) {
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function send() {
    setPending(true);
    setStatus(null);
    const res = await fetch("/api/admin/emails/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sequence, step, variant }),
    });
    const data = (await res.json().catch(() => ({}))) as { to?: string; message?: string };
    setStatus(res.ok ? `Sent to ${data.to}.` : (data.message ?? "Couldn't send."));
    setPending(false);
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm" variant="secondary" disabled={pending} onClick={send}>
        {pending ? "Sending…" : "Send a test to me"}
      </Button>
      <span role="status" className="text-sm text-muted">
        {status}
      </span>
    </div>
  );
}
