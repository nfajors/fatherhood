"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import type { PlanId } from "@/lib/config";

/** Starts Stripe Checkout; sends signed-out visitors to sign up first. */
export function SubscribeButton({ plan, children, ...props }: { plan: PlanId } & ButtonProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      if (res.status === 401) {
        router.push(`/sign-up?next=${encodeURIComponent(`/pricing?plan=${plan}`)}`);
        return;
      }
      const data = (await res.json()) as { url?: string };
      if (!res.ok || !data.url) throw new Error();
      window.location.assign(data.url);
    } catch {
      setError("Checkout could not start. Please try again.");
      setPending(false);
    }
  }

  return (
    <div>
      <Button onClick={start} disabled={pending} {...props}>
        {pending ? "Starting checkout..." : children}
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
