"use client";

import { useState } from "react";
import { ErrorText, useApiAction } from "@/components/use-api-action";
import { Button } from "@/components/ui/button";

const field = "mt-1 block w-full rounded-md border border-navy-900/20 bg-white px-3 py-2";

export function PayoutActions({ payoutId, canSend, amount, name }: { payoutId: string; canSend: boolean; amount: string; name: string }) {
  const { pending, error, run } = useApiAction();
  const [marking, setMarking] = useState(false);
  const [note, setNote] = useState("");
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {canSend && (
          <Button
            size="sm"
            disabled={pending}
            onClick={() => {
              if (window.confirm(`Send ${amount} to ${name} now?`)) run(`/api/admin/payouts/${payoutId}/send`, "POST");
            }}
          >
            Send now
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => setMarking((m) => !m)} aria-expanded={marking}>
          Paid another way
        </Button>
      </div>
      {marking && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(`/api/admin/payouts/${payoutId}/mark-paid`, "POST", { note }, () => setMarking(false));
          }}
        >
          <label className="block text-sm font-medium">
            How it was paid
            <input value={note} onChange={(e) => setNote(e.target.value)} required maxLength={500} className={field} placeholder="Check #1042, mailed Nov 3" />
          </label>
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            Mark {amount} paid
          </Button>
        </form>
      )}
      <ErrorText error={error} />
    </div>
  );
}

export function SettleMonthForm({ defaultMonth }: { defaultMonth: string }) {
  const { pending, error, run } = useApiAction();
  const [month, setMonth] = useState(defaultMonth);
  const [done, setDone] = useState<string | null>(null);
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setDone(null);
        run("/api/admin/payouts/settle", "POST", { month }, () => setDone(month));
      }}
    >
      <label className="block text-sm font-medium">
        Month
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} required className={field} />
      </label>
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Settling..." : "Settle month"}
      </Button>
      {done && (
        <p role="status" className="w-full text-sm text-emerald-800">
          ✓ {done} is settled.
        </p>
      )}
      <ErrorText error={error} />
    </form>
  );
}
