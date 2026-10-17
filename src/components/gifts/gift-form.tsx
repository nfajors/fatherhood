"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { GIFT_MESSAGE_MAX_CHARS, GIFT_TERMS, PLANS, type PlanId } from "@/lib/config";
import { cn } from "@/lib/utils";

type When = "now" | "date" | "self";

const field = "mt-1 block w-full rounded-md border border-navy-900/20 bg-white px-3 py-2.5 text-ink";

/** Local date in YYYY-MM-DD, for the date input's min/max. */
function isoDate(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

export function GiftForm({ defaultName, defaultEmail }: { defaultName?: string; defaultEmail?: string }) {
  const [plan, setPlan] = useState<PlanId>("annual");
  const [when, setWhen] = useState<When>("now");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = new Date();
  const maxDate = new Date(today.getTime() + 365 * 24 * 60 * 60 * 1000);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const date = String(form.get("deliverDate") ?? "");
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/gifts/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan,
          purchaserName: form.get("purchaserName"),
          purchaserEmail: form.get("purchaserEmail"),
          recipientName: form.get("recipientName"),
          delivery: when === "self" ? "self" : "email",
          recipientEmail: when === "self" ? undefined : form.get("recipientEmail"),
          message: message.trim() || undefined,
          // 8 a.m. in the buyer's own time zone on the chosen day.
          deliverAt: when === "date" && date ? new Date(`${date}T08:00:00`).toISOString() : undefined,
        }),
      });
      const data = (await res.json()) as { url?: string };
      if (!res.ok || !data.url) throw new Error();
      window.location.assign(data.url);
    } catch {
      setError("Something went wrong starting checkout. Please check the form and try again.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-8">
      <fieldset>
        <legend className="text-lg font-semibold text-navy-900">Choose a gift</legend>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {(["annual", "monthly"] as const).map((id) => (
            <label
              key={id}
              className={cn(
                "flex cursor-pointer flex-col rounded-xl border-2 bg-white p-5 has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-gold-500 has-[input:focus-visible]:ring-offset-2",
                plan === id ? "border-gold-500" : "border-navy-900/10",
              )}
            >
              <input type="radio" name="plan" value={id} checked={plan === id} onChange={() => setPlan(id)} className="sr-only" />
              <span className="font-serif text-3xl text-navy-900">${PLANS[id].amountCents / 100}</span>
              <span className="mt-1 text-muted">{GIFT_TERMS[id].label} of membership</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-lg font-semibold text-navy-900">Who is it for?</legend>
        <label className="block text-sm font-medium">
          Their name
          <input name="recipientName" required maxLength={60} className={field} />
        </label>
        <div>
          <span className="block text-sm font-medium">How should they get it?</span>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {(
              [
                ["now", "Email it now"],
                ["date", "Email it on a date"],
                ["self", "I'll give it myself"],
              ] as const
            ).map(([value, label]) => (
              <label
                key={value}
                className={cn(
                  "cursor-pointer rounded-md border px-3 py-2.5 text-center text-sm has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-gold-500 has-[input:focus-visible]:ring-offset-2",
                  when === value ? "border-gold-500 bg-gold-100 font-semibold" : "border-navy-900/20 bg-white",
                )}
              >
                <input type="radio" name="when" value={value} checked={when === value} onChange={() => setWhen(value)} className="sr-only" />
                {label}
              </label>
            ))}
          </div>
        </div>
        {when !== "self" && (
          <label className="block text-sm font-medium">
            Their email
            <input name="recipientEmail" type="email" required maxLength={254} className={field} />
          </label>
        )}
        {when === "date" && (
          <label className="block text-sm font-medium">
            Delivery date (sent at 8 a.m. your time)
            <input name="deliverDate" type="date" required min={isoDate(today)} max={isoDate(maxDate)} className={field} />
          </label>
        )}
        {when === "self" && (
          <p className="text-sm text-muted">You&apos;ll get the gift code on the next page and by email, to share however you like.</p>
        )}
        <label className="block text-sm font-medium">
          Personal message (optional)
          <textarea
            name="message"
            rows={4}
            maxLength={GIFT_MESSAGE_MAX_CHARS}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className={field}
          />
          <span className="mt-1 block text-right text-xs text-muted">
            {message.length}/{GIFT_MESSAGE_MAX_CHARS}
          </span>
        </label>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-lg font-semibold text-navy-900">From you</legend>
        <label className="block text-sm font-medium">
          Sign it as
          <input name="purchaserName" required maxLength={60} defaultValue={defaultName} placeholder="e.g. Dad, or Marcus" className={field} />
        </label>
        <label className="block text-sm font-medium">
          Your email (for the receipt and code)
          <input name="purchaserEmail" type="email" required maxLength={254} defaultValue={defaultEmail} className={field} />
        </label>
      </fieldset>

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={pending} className="w-full sm:w-auto">
        {pending ? "Starting checkout..." : `Continue to payment: $${PLANS[plan].amountCents / 100}`}
      </Button>
    </form>
  );
}
