"use client";

import { useState } from "react";
import { ErrorText } from "@/components/use-api-action";
import { Button } from "@/components/ui/button";

/** POST to an endpoint that returns { url }, then go there (Stripe onboarding or the Express dashboard). */
function useRedirectAction(endpoint: string) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    setPending(true);
    setError(null);
    const res = await fetch(endpoint, { method: "POST" });
    const data = (await res.json().catch(() => ({}))) as { url?: string; message?: string; error?: string };
    if (res.ok && data.url) {
      window.location.assign(data.url);
      return;
    }
    setError(data.message ?? data.error ?? `Something went wrong (${res.status}). Please try again.`);
    setPending(false);
  }
  return { pending, error, go };
}

export function SetUpPayoutsButton({ label }: { label: string }) {
  const { pending, error, go } = useRedirectAction("/api/studio/payouts/onboarding");
  return (
    <div>
      <Button onClick={go} disabled={pending}>
        {pending ? "Opening Stripe..." : label}
      </Button>
      <ErrorText error={error} />
    </div>
  );
}

export function StripeDashboardButton() {
  const { pending, error, go } = useRedirectAction("/api/studio/payouts/dashboard");
  return (
    <div>
      <Button variant="outline" size="sm" onClick={go} disabled={pending}>
        {pending ? "Opening..." : "Bank details and deposits"}
      </Button>
      <ErrorText error={error} />
    </div>
  );
}
