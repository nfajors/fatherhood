"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorText, useApiAction } from "@/components/use-api-action";

const dollars = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

/** Send payouts (all ready ones, or one), confirming the amount first and reporting what happened. */
export function SendPayoutsButton({ count, cents, ids, label, size = "md" }: { count: number; cents: number; ids?: string[]; label?: string; size?: "sm" | "md" }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  async function send() {
    if (!window.confirm(`Send ${count} payout${count === 1 ? "" : "s"} totaling ${dollars(cents)} now? This moves real money.`)) return;
    setPending(true);
    setReport(null);
    const res = await fetch("/api/admin/payouts/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
    const data = (await res.json().catch(() => ({}))) as { paid?: unknown[]; failed?: { reason: string }[]; message?: string };
    setReport(
      res.ok
        ? `Sent ${data.paid?.length ?? 0}.${data.failed?.length ? ` ${data.failed.length} failed: ${data.failed[0]!.reason}` : ""}`
        : (data.message ?? `Couldn't send (${res.status}).`),
    );
    setPending(false);
    router.refresh();
  }
  return (
    <div>
      <Button size={size} disabled={pending || count === 0} onClick={send}>
        {pending ? "Sending…" : (label ?? `Send ${count} payout${count === 1 ? "" : "s"} (${dollars(cents)})`)}
      </Button>
      {report && (
        <p role="status" className="mt-2 text-sm">
          {report}
        </p>
      )}
    </div>
  );
}

export function RetryPayoutButton({ id }: { id: string }) {
  const { pending, error, run } = useApiAction();
  return (
    <div>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(`/api/admin/payouts/${id}/retry`, "POST")}>
        Put back in queue
      </Button>
      <ErrorText error={error} />
    </div>
  );
}

/** Settle a month (or recalculate one whose payouts haven't been tried). */
export function SettleMonthForm({ months }: { months: { value: string; label: string; settled: boolean }[] }) {
  const { pending, error, run } = useApiAction();
  const [month, setMonth] = useState(months.find((m) => !m.settled)?.value ?? months[0]?.value ?? "");
  const settled = months.find((m) => m.value === month)?.settled ?? false;
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (settled && !window.confirm("Recalculate this month? Its payouts are withdrawn and recreated from fresh numbers.")) return;
        run("/api/admin/payouts/settle", "POST", { month, force: settled });
      }}
    >
      <label className="block text-sm font-medium">
        Month
        <select value={month} onChange={(e) => setMonth(e.target.value)} className="mt-1 block rounded-md border border-navy-900/20 bg-white px-3 py-2">
          {months.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
              {m.settled ? " (settled)" : ""}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" variant="secondary" disabled={pending || !month}>
        {settled ? "Recalculate" : "Settle"}
      </Button>
      <div className="w-full">
        <ErrorText error={error} />
      </div>
    </form>
  );
}
