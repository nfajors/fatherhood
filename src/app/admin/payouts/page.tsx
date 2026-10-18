import { desc } from "drizzle-orm";
import type { Metadata } from "next";
import { RetryPayoutButton, SendPayoutsButton, SettleMonthForm } from "@/components/admin/payout-actions";
import { Card } from "@/components/ui/card";
import { getDb } from "@/lib/db";
import { poolCalculations } from "@/lib/db/schema";
import { formatMoney } from "@/lib/format";
import { autoSendEnabled, getConnectGateway, SETTLE_ON_DAY } from "@/lib/payouts/runtime";
import { payoutQueue, payoutState, payoutTotals, PAYOUT_POLICY } from "@/lib/payouts/service";
import { REVENUE_POLICY } from "@/lib/revenue/policy";

export const metadata: Metadata = { title: "Payouts (admin)", robots: { index: false } };
export const dynamic = "force-dynamic";

const STATE_LABEL = {
  ready: "Ready to send",
  retrying: "Failed, will retry",
  failed: "Failed",
  sending: "Sending",
  needs_account: "Creator hasn't set up payouts",
  account_incomplete: "Creator's Stripe setup incomplete",
  paid: "Paid",
} as const;

const month = (d: Date) => d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
const day = (d: Date) => d.toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" });

async function platformBalance(): Promise<number | null> {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  return getConnectGateway()
    .availableBalanceCents()
    .catch(() => null);
}

export default async function AdminPayoutsPage() {
  const db = getDb();
  const [queue, totals, calculations, balance] = await Promise.all([
    payoutQueue(db),
    payoutTotals(db),
    db.select().from(poolCalculations).orderBy(desc(poolCalculations.periodStart)).limit(12),
    platformBalance(),
  ]);
  const readyIds = queue.filter((r) => ["ready", "retrying"].includes(payoutState(r))).map((r) => r.payout.id);
  const now = new Date();
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1 - i, 1));
    return { value: d.toISOString().slice(0, 7), label: d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }), settled: calculations.some((c) => c.periodStart.getTime() === d.getTime()) };
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-semibold">Payouts</h1>
      <p className="mt-2 max-w-3xl text-muted">
        Each month is settled from the {SETTLE_ON_DAY}th of the next, and creators whose balance reaches the minimum get a payout. Payouts are sent as
        Stripe transfers to each creator&apos;s Stripe account, and Stripe pays their bank.{" "}
        {autoSendEnabled()
          ? "Automatic sending is on: ready payouts go out daily."
          : "Automatic sending is off: payouts go out when you send them here (set PAYOUTS_AUTO_SEND=true to send daily)."}
      </p>
      {!process.env.STRIPE_SECRET_KEY && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Stripe isn&apos;t configured, so nothing can be sent.</p>}

      <section aria-label="Summary" className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: "Available in Stripe", value: balance === null ? "Unavailable" : formatMoney(balance), detail: "Transfers can't exceed this" },
          { label: "Ready to send", value: formatMoney(totals.ready.cents), detail: `${totals.ready.count} payout${totals.ready.count === 1 ? "" : "s"}` },
          { label: "Waiting on creators", value: formatMoney(totals.waitingOnCreators.cents), detail: `${totals.waitingOnCreators.count} payout${totals.waitingOnCreators.count === 1 ? "" : "s"}, until creators set up payouts` },
          { label: "Failed", value: formatMoney(totals.failed.cents), detail: `${totals.failed.count} out of retries` },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-navy-900/10 bg-white p-5 shadow-sm">
            <p className="text-sm text-muted">{s.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{s.value}</p>
            <p className="mt-1 text-xs text-muted">{s.detail}</p>
          </div>
        ))}
      </section>
      {balance !== null && balance < totals.ready.cents && (
        <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          The available Stripe balance is less than what&apos;s ready to send. Some transfers will fail until more funds are available.
        </p>
      )}
      <div className="mt-6">
        <SendPayoutsButton count={readyIds.length} cents={totals.ready.cents} ids={readyIds} />
      </div>

      <section className="mt-10" aria-labelledby="queue">
        <h2 id="queue" className="text-2xl font-semibold">
          Payouts
        </h2>
        {queue.length === 0 ? (
          <p className="mt-3 text-muted">No payouts yet. They&apos;re created when a month is settled.</p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-xl border border-navy-900/10 bg-white">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">Creator</th>
                  <th className="px-4 py-2 font-medium">For</th>
                  <th className="px-4 py-2 text-right font-medium">Amount</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-900/10">
                {queue.map((row) => {
                  const state = payoutState(row);
                  const p = row.payout;
                  return (
                    <tr key={p.id} className="align-top">
                      <td className="px-4 py-3">
                        <span className="block font-medium text-navy-900">{row.creatorName}</span>
                        <span className="text-muted">{row.creatorEmail}</span>
                      </td>
                      <td className="px-4 py-3">
                        {month(p.periodStart)}
                        {month(p.periodStart) !== month(new Date(p.periodEnd.getTime() - 1)) ? ` – ${month(new Date(p.periodEnd.getTime() - 1))}` : ""}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatMoney(p.amountCents)}</td>
                      <td className="px-4 py-3">
                        <span className={state === "paid" ? "text-green-800" : state === "failed" || state === "retrying" ? "text-red-700" : ""}>{STATE_LABEL[state]}</span>
                        {state === "paid" && p.paidAt && <span className="block text-xs text-muted">{day(p.paidAt)} · {p.stripeTransferId}</span>}
                        {p.failureReason && state !== "paid" && <span className="block text-xs text-muted">{p.failureReason}</span>}
                        {p.attempts > 0 && state !== "paid" && (
                          <span className="block text-xs text-muted">
                            {p.attempts} of {PAYOUT_POLICY.maxAttempts} attempts
                          </span>
                        )}
                        {state === "account_incomplete" && row.requirementsDue?.length ? (
                          <span className="block text-xs text-muted">Stripe needs: {row.requirementsDue.slice(0, 3).join(", ")}</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {state === "failed" && <RetryPayoutButton id={p.id} />}
                        {(state === "ready" || state === "retrying") && <SendPayoutsButton size="sm" count={1} cents={p.amountCents} ids={[p.id]} label="Send now" />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-10" aria-labelledby="settlements">
        <h2 id="settlements" className="text-2xl font-semibold">
          Monthly settlements
        </h2>
        <Card className="mt-4">
          <SettleMonthForm months={months} />
          <p className="mt-3 text-xs text-muted">
            A month can be recalculated until any of its payouts has been sent or tried. Balances under {formatMoney(REVENUE_POLICY.minPayoutCents)} carry forward.
          </p>
        </Card>
        {calculations.length > 0 && (
          <div className="mt-4 overflow-x-auto rounded-xl border border-navy-900/10 bg-white">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">Month</th>
                  <th className="px-4 py-2 text-right font-medium">Subscription revenue</th>
                  <th className="px-4 py-2 text-right font-medium">Creator pool</th>
                  <th className="px-4 py-2 text-right font-medium">Creators</th>
                  <th className="px-4 py-2 font-medium">Settled</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-900/10">
                {calculations.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-2">{month(c.periodStart)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatMoney(c.subscriptionRevenueCents)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatMoney(c.poolCents)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{c.eligibleCreators}</td>
                    <td className="px-4 py-2">{c.completedAt ? day(c.completedAt) : c.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
