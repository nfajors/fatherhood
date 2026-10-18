import type { Metadata } from "next";
import { EligibilityChecklist, Stat } from "@/components/studio/earnings";
import { StripeLinkButton } from "@/components/studio/payout-account";
import { Card } from "@/components/ui/card";
import { getSessionUser } from "@/lib/auth";
import { earningsEstimate, earningsHistory } from "@/lib/creators/dashboard";
import { getDb } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import { payoutAccount, PAYOUT_POLICY, type PayoutAccount } from "@/lib/payouts/service";
import { REVENUE_POLICY as P } from "@/lib/revenue/policy";

export const metadata: Metadata = { title: "Earnings", robots: { index: false } };

const month = (d: Date) => d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const day = (d: Date) => d.toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" });

const PAYOUT_STATUS = { pending: "Scheduled", processing: "Sending", paid: "Paid", failed: "Delayed" } as const;

/** A payout's status as the creator should read it. */
function payoutLabel(p: { status: keyof typeof PAYOUT_STATUS; attempts: number }, ready: boolean): string {
  if (p.status === "pending" && !ready) return "Waiting for payout setup";
  if (p.status === "failed") return p.attempts >= PAYOUT_POLICY.maxAttempts ? "Delayed: we're looking into it" : "Delayed: retrying soon";
  return PAYOUT_STATUS[p.status];
}

/** Stripe's requirement keys, made readable ("individual.verification.document" -> "verification document"). */
const requirement = (key: string) => key.split(".").slice(-2).join(" ").replace(/_/g, " ");

function PayoutAccountCard({ account, owedCents, updated }: { account: PayoutAccount | null; owedCents: number; updated: boolean }) {
  const owed = owedCents > 0 ? ` You have ${formatMoney(owedCents)} waiting.` : "";
  let title: string;
  let body: string;
  let action: React.ReactNode = null;
  let tone = "border-navy-900/10 bg-white";
  if (!account) {
    title = "Set up payouts";
    body = `Payouts go straight to your bank through Stripe, our payments partner. Stripe asks for your bank details and tax information (it takes about five minutes, and we never see your bank details). Payouts are available in the United States for now.${owed}`;
    action = <StripeLinkButton endpoint="/api/studio/payouts/onboard" label="Set up payouts" />;
    if (owedCents > 0) tone = "border-gold-500/50 bg-gold-100";
  } else if (account.disabledReason === "disconnected") {
    title = "Payouts are disconnected";
    body = "Your Stripe account was disconnected from Fatherhood.School, so we can't send payouts. Reply to any email from us and we'll help you reconnect.";
    tone = "border-amber-300 bg-amber-50";
  } else if (!account.detailsSubmitted) {
    title = "Finish setting up payouts";
    body = `You've started with Stripe but haven't finished.${owed}`;
    action = <StripeLinkButton endpoint="/api/studio/payouts/onboard" label="Continue setup" />;
    tone = "border-gold-500/50 bg-gold-100";
  } else if (!account.payoutsEnabled) {
    title = account.requirementsDue.length ? "Stripe needs a few more details" : "Stripe is checking your details";
    body = account.requirementsDue.length
      ? `Before payouts can start, Stripe needs: ${account.requirementsDue.slice(0, 4).map(requirement).join(", ")}.`
      : "This usually takes a few minutes, sometimes a day or two. We'll send your payouts as soon as Stripe is done.";
    action = account.requirementsDue.length ? <StripeLinkButton endpoint="/api/studio/payouts/onboard" label="Update details" /> : null;
    tone = "border-amber-300 bg-amber-50";
  } else {
    title = "Payouts are on";
    body = "We send each payout to your Stripe account, and Stripe moves it to your bank, usually within two business days. Your bank details, payout history and tax forms are in your Stripe dashboard.";
    action = <StripeLinkButton endpoint="/api/studio/payouts/dashboard" label="Open Stripe dashboard" variant="outline" />;
  }
  return (
    <section id="payouts" aria-labelledby="payout-account" className={`mt-8 rounded-xl border p-5 ${tone}`}>
      {updated && <p className="mb-3 text-sm font-medium text-green-800">Thanks. Your payout details are saved.</p>}
      <h2 id="payout-account" className="text-lg font-semibold">
        {account?.payoutsEnabled && <span aria-hidden>✓ </span>}
        {title}
      </h2>
      <p className="mt-1 max-w-3xl text-sm text-ink">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </section>
  );
}

export default async function EarningsPage({ searchParams }: { searchParams: Promise<{ payouts?: string }> }) {
  const sessionUser = (await getSessionUser())!;
  const db = getDb();
  const [estimate, history, account, { payouts: payoutsParam }] = await Promise.all([
    earningsEstimate(db, sessionUser.id),
    earningsHistory(db, sessionUser.id),
    payoutAccount(db, sessionUser.id),
    searchParams,
  ]);
  const { balances } = history;
  const ready = Boolean(account?.payoutsEnabled);

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
        <Stat
          label="Payout on the way"
          value={formatMoney(balances.inPayoutCents)}
          detail={balances.inPayoutCents > 0 && !ready ? "Set up payouts to receive it" : undefined}
        />
        <Stat label="Paid to date" value={formatMoney(balances.paidCents)} />
      </section>

      <PayoutAccountCard account={account} owedCents={balances.inPayoutCents} updated={payoutsParam === "updated"} />

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
                  <th className="py-2 pl-4 text-right font-normal">Counts</th>
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
                    <span className="ml-2 text-xs font-normal text-muted">{s.payoutStatus ? payoutLabel({ status: s.payoutStatus, attempts: 0 }, ready) : "Carried forward"}</span>
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
        <section aria-labelledby="payout-history" className="mt-10">
          <h2 id="payout-history" className="text-2xl font-semibold">
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
                  <td className="py-2">{payoutLabel(p, ready)}</td>
                  <td className="py-2 text-right tabular-nums">{formatMoney(p.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-muted">Questions about a payout? Reply to any email from us.</p>
        </section>
      )}
    </div>
  );
}
