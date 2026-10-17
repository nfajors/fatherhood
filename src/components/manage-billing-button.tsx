"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function ManageBillingButton() {
  const [pending, setPending] = useState(false);
  async function open() {
    setPending(true);
    const res = await fetch("/api/stripe/portal", { method: "POST" });
    const data = (await res.json().catch(() => ({}))) as { url?: string };
    if (data.url) window.location.assign(data.url);
    else setPending(false);
  }
  return (
    <Button variant="outline" onClick={open} disabled={pending}>
      {pending ? "Opening..." : "Manage billing"}
    </Button>
  );
}
