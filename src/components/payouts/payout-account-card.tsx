import { Card } from "@/components/ui/card";
import { formatMoney } from "@/lib/format";
import type { PayoutReadiness } from "@/lib/payouts/accounts";
import { SetUpPayoutsButton, StripeDashboardButton } from "./payout-account-actions";

const COPY: Record<PayoutReadiness, { title: string; body: string; action?: string }> = {
  none: {
    title: "Set up payouts",
    body: "Payouts are sent through Stripe, our payments partner. Setup takes a few minutes: your name, a bank account and tax details. Stripe keeps them; we never see your bank account.",
    action: "Set up payouts",
  },
  incomplete: {
    title: "Finish setting up payouts",
    body: "Stripe needs a little more information before we can send you money.",
    action: "Continue with Stripe",
  },
  verifying: {
    title: "Stripe is checking your details",
    body: "This usually takes a few minutes, sometimes a day or two. We'll send payouts as soon as it's done.",
  },
  ready: {
    title: "Payouts are set up",
    body: "Payouts are sent to your Stripe account automatically after each month is settled. Stripe then deposits them in your bank.",
  },
  disconnected: {
    title: "Payouts are disconnected",
    body: "Your Stripe account is no longer connected to Fatherhood.School. Connect an account to receive payouts.",
    action: "Connect a Stripe account",
  },
};

/** The creator's payout account: what to do next, without relying on color. */
export function PayoutAccountCard({ readiness, waitingCents }: { readiness: PayoutReadiness; waitingCents: number }) {
  const copy = COPY[readiness];
  return (
    <Card className={readiness === "ready" ? undefined : "border-gold-500/60"}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-xl">
          <h2 id="payout-account" className="text-lg font-semibold">
            <span aria-hidden className="mr-2">
              {readiness === "ready" ? "✓" : "!"}
            </span>
            {copy.title}
          </h2>
          <p className="mt-1 text-sm text-muted">{copy.body}</p>
          {readiness !== "ready" && waitingCents > 0 && (
            <p className="mt-2 text-sm font-semibold">{formatMoney(waitingCents)} is waiting for you.</p>
          )}
        </div>
        <div className="flex flex-col items-start gap-2">
          {copy.action && <SetUpPayoutsButton label={copy.action} />}
          {(readiness === "ready" || readiness === "verifying") && <StripeDashboardButton />}
        </div>
      </div>
    </Card>
  );
}
