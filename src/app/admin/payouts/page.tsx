import type { Metadata } from "next";
import { PayoutActions, SettleMonthForm } from "@/components/admin/payout-actions";
import { Stat } from "@/components/studio/earnings";
import { Card } from "@/components/ui/card";
import { getDb } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import { REVENUE_POLICY } from "@/lib/revenue/policy";
import { READINESS_LABEL } from "@/lib/payouts/accounts";
import { PAYOUT_POLICY } from "@/lib/payouts/policy";
import { autoSendEnabled } from "@/lib/payouts/runtime";
import { payoutsOverview } from "@/lib/payouts/service";

export const metadata: Metadata = { title: "Payouts (admin)", robots: { index: false } };

const month = (d: Date) => d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
const day = (d: Date) => d.toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" });
const STATUS = { pending: "Waiting", processing: "Sending", paid: "Paid", failed: "Failed" } as const;

function lastMonth(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return d.toISOString().slice(0, 7);
}

export default async function AdminPayoutsPage() {
  const { open, paid, settlements, totals } = await payoutsOverview(getDb());
  const autoSend = autoSendEnabled();

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-semibold">Payouts</h1>
      <p className="mt-2 max-w-3xl text-muted">
        Each month is settled on the 2nd, which creates payouts for creators whose balance reached {formatMoney(REVENUE_POLICY.minPayoutCents)}. Payouts go to each
        creator&apos;s Stripe Express account as a transfer from the platform balance.{" "}
        {autoSend
          ? `Automatic sending is on: payouts go out daily once they are ${PAYOUT_POLICY.holdDays} days old.`
          : "Automatic sending is off (set PAYOUTS_AUTO_SEND=true to turn it on), so send them from here."}
      </p>

      <section aria-label="Totals" className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Owed to creators" value={formatMoney(totals.openCents)} />
        <Stat label="Ready to send" value={formatMoney(totals.readyCents)} detail="Creator's Stripe account is ready" />
        <Stat label="Waiting on creator setup" value={formatMoney(totals.waitingOnSetupCents)} detail="They're emailed once per payout" />
        <Stat label="Failed" value={String(totals.failedCount)} detail={totals.failedCount ? "Fix in Stripe, then send again" : undefined} />
      </section>

      <section aria-labelledby="open" className="mt-10">
        <h2 id="open" className="text-xl font-semibold">
          To pay <span className="text-muted">({open.length})</span>
        </h2>
        {open.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Nothing owed right now.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {open.map((p) => (
              <Card key={p.id} className="p-4">
                <div className="grid gap-4 md:grid-cols-[1fr_auto]">
                  <div>
                    <p className="flex flex-wrap items-baseline gap-x-3">
                      <span className="text-lg font-semibold tabular-nums">{formatMoney(p.amountCents)}</span>
                      <span className="font-semibold">{p.name}</span>
                      <span className="break-all text-sm text-muted">{p.email}</span>
                    </p>
                    <p className="mt-1 text-sm text-muted">
                      Earned {month(p.periodStart)}
                      {month(p.periodStart) !== month(new Date(p.periodEnd.getTime() - 1)) && ` – ${month(new Date(p.periodEnd.getTime() - 1))}`} · created{" "}
                      {day(p.createdAt)}
                      {p.attempts > 0 && ` · ${p.attempts} ${p.attempts === 1 ? "attempt" : "attempts"}`}
                    </p>
                    <p className="mt-2 text-sm">
                      <strong>{STATUS[p.status]}</strong>
                      {p.onHoldUntil && autoSend && ` · sends automatically after ${day(p.onHoldUntil)}`} · Stripe account:{" "}
                      {READINESS_LABEL[p.readiness].toLowerCase()}
                    </p>
                    {p.failureReason && (
                      <p className="mt-1 text-sm text-red-800">
                        {p.status === "failed" ? "Failed: " : "Last attempt: "}
                        {p.failureReason}
                      </p>
                    )}
                  </div>
                  {p.status !== "processing" && (
                    <PayoutActions payoutId={p.id} canSend={p.readiness === "ready"} amount={formatMoney(p.amountCents)} name={p.name} />
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <div className="mt-10 grid gap-8 lg:grid-cols-2">
        <section aria-labelledby="settlements">
          <h2 id="settlements" className="text-xl font-semibold">
            Settled months
          </h2>
          <Card className="mt-4">
            <SettleMonthForm defaultMonth={lastMonth()} />
            <p className="mt-2 text-xs text-muted">Settling a month that is already settled shows the stored result. To recalculate, use npm run revenue:settle -- YYYY-MM --force before anything is paid.</p>
          </Card>
          {settlements.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-muted">
                  <tr>
                    <th className="py-2 font-normal">Month</th>
                    <th className="py-2 text-right font-normal">Revenue</th>
                    <th className="py-2 text-right font-normal">Pool</th>
                    <th className="py-2 text-right font-normal">Creators</th>
                  </tr>
                </thead>
                <tbody>
                  {settlements.map((s) => (
                    <tr key={s.id} className="border-t border-navy-900/5">
                      <td className="py-2">{month(s.periodStart)}</td>
                      <td className="py-2 text-right tabular-nums">{formatMoney(s.subscriptionRevenueCents)}</td>
                      <td className="py-2 text-right tabular-nums">{formatMoney(s.poolCents)}</td>
                      <td className="py-2 text-right tabular-nums">{s.eligibleCreators}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section aria-labelledby="paid">
          <h2 id="paid" className="text-xl font-semibold">
            Recently paid
          </h2>
          {paid.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No payouts yet.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-muted">
                  <tr>
                    <th className="py-2 font-normal">Paid</th>
                    <th className="py-2 font-normal">Creator</th>
                    <th className="py-2 font-normal">How</th>
                    <th className="py-2 text-right font-normal">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {paid.map((p) => (
                    <tr key={p.id} className="border-t border-navy-900/5 align-top">
                      <td className="py-2 whitespace-nowrap">{p.paidAt ? day(p.paidAt) : ""}</td>
                      <td className="py-2">{p.name}</td>
                      <td className="py-2 text-muted">{p.stripeTransferId ? <code className="text-xs">{p.stripeTransferId}</code> : p.manualNote}</td>
                      <td className="py-2 text-right tabular-nums">{formatMoney(p.amountCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
