import type { Metadata } from "next";
import { EligibilityChecklist, Stat } from "@/components/studio/earnings";
import { Card } from "@/components/ui/card";
import { getSessionUser } from "@/lib/auth";
import { earningsEstimate, earningsHistory } from "@/lib/creators/dashboard";
import { getDb } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import { REVENUE_POLICY as P } from "@/lib/revenue/policy";

export const metadata: Metadata = { title: "Earnings", robots: { index: false } };

const month = (d: Date) => d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const day = (d: Date) => d.toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" });

const PAYOUT_STATUS = { pending: "Scheduled", processing: "Sending", paid: "Paid", failed: "Failed" } as const;

export default async function EarningsPage() {
  const sessionUser = (await getSessionUser())!;
  const db = getDb();
  const [estimate, history] = await Promise.all([earningsEstimate(db, sessionUser.id), earningsHistory(db, sessionUser.id)]);
  const { balances } = history;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-semibold">Earnings</h1>
      <p className="mt-2 max-w-2xl text-muted">
        {P.poolShareBps / 100}% of membership revenue goes into a creator pool each month, shared by engagement: half for videos published
        this quarter, half for views this month. Payouts go out once your balance reaches {formatMoney(P.minPayoutCents)}.
      </p>

      <section aria-label="Balances" className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label={`${month(estimate.month.start)} (estimate)`} value={formatMoney(estimate.estimatedCents)} detail="Final when the month closes" />
        <Stat
          label="Unpaid balance"
          value={formatMoney(balances.unpaidCents)}
          detail={balances.unpaidCents < balances.minPayoutCents ? `Carries forward until ${formatMoney(balances.minPayoutCents)}` : "In the next payout"}
        />
        <Stat label="Payout on the way" value={formatMoney(balances.inPayoutCents)} />
        <Stat label="Paid to date" value={formatMoney(balances.paidCents)} />
      </section>

      <div className="mt-8 grid gap-6 lg:grid-cols-[20rem_1fr]">
        <Card>
          <h2 className="text-lg font-semibold">To share in this month&apos;s pool</h2>
          <EligibilityChecklist estimate={estimate} className="mt-4" />
        </Card>
        <Card>
          <h2 className="text-lg font-semibold">Views this month, by video</h2>
          <p className="mt-1 text-sm text-muted">
            Views of at least 30 seconds. A video counts once it reaches {P.minViewsPerVideo} views in the month.
          </p>
          {estimate.videos.length === 0 ? (
            <p className="mt-4 text-sm text-muted">No views yet this month.</p>
          ) : (
            <table className="mt-4 w-full text-left text-sm">
              <thead className="text-muted">
                <tr>
                  <th className="py-2 font-normal">Video</th>
                  <th className="py-2 text-right font-normal">Views</th>
                  <th className="py-2 text-right font-normal">Counts</th>
                </tr>
              </thead>
              <tbody>
                {estimate.videos.map((v) => (
                  <tr key={v.videoId} className="border-t border-navy-900/5">
                    <td className="py-2">{v.title}</td>
                    <td className="py-2 text-right tabular-nums">{v.qualifyingViews}</td>
                    <td className="py-2 text-right">{v.counts ? "✓ Yes" : `${P.minViewsPerVideo - v.qualifyingViews} to go`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <section aria-labelledby="months" className="mt-10">
        <h2 id="months" className="text-2xl font-semibold">
          Past months
        </h2>
        {history.shares.length === 0 ? (
          <p className="mt-3 text-muted">Nothing settled yet. Each month is settled in the first days of the next.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {history.shares.map((s) => (
              <details key={s.id} className="rounded-xl border border-navy-900/10 bg-white p-4">
                <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">{month(s.periodStart)}</span>
                  <span className="text-sm text-muted">
                    {s.videosPostedInQuarter} {s.videosPostedInQuarter === 1 ? "video" : "videos"} this quarter · {s.qualifyingViews} views · score {s.score.toFixed(1)}
                  </span>
                  <span className="font-semibold tabular-nums">
                    {formatMoney(s.amountCents)}
                    <span className="ml-2 text-xs font-normal text-muted">{s.payoutStatus ? PAYOUT_STATUS[s.payoutStatus] : "Unpaid"}</span>
                  </span>
                </summary>
                <ul className="mt-3 space-y-1 text-sm">
                  {s.breakdown.map((v) => (
                    <li key={v.videoId} className="flex justify-between gap-4">
                      <span>{v.title}</span>
                      <span className="tabular-nums text-muted">{v.qualifyingViews} views</span>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        )}
      </section>

      {history.payouts.length > 0 && (
        <section aria-labelledby="payouts" className="mt-10">
          <h2 id="payouts" className="text-2xl font-semibold">
            Payouts
          </h2>
          <table className="mt-4 w-full max-w-xl text-left text-sm">
            <thead className="text-muted">
              <tr>
                <th className="py-2 font-normal">Date</th>
                <th className="py-2 font-normal">Status</th>
                <th className="py-2 text-right font-normal">Amount</th>
              </tr>
            </thead>
            <tbody>
              {history.payouts.map((p) => (
                <tr key={p.id} className="border-t border-navy-900/5">
                  <td className="py-2">{day(p.paidAt ?? p.createdAt)}</td>
                  <td className="py-2">{PAYOUT_STATUS[p.status]}</td>
                  <td className="py-2 text-right tabular-nums">{formatMoney(p.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-muted">Payouts are sent by our team for now. Questions about a payout? Reply to any email from us.</p>
        </section>
      )}
    </div>
  );
}
