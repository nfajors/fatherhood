/**
 * Stripe Connect account state, as we store and show it. Pure.
 */
import type Stripe from "stripe";

/** What we keep from a Stripe account (see creator_payout_accounts). */
export type ConnectAccountState = {
  stripeAccountId: string;
  detailsSubmitted: boolean;
  payoutsEnabled: boolean;
  transfersActive: boolean;
  requirementsDue: string[];
  disabledReason: string | null;
};

export function toAccountState(account: Stripe.Account): ConnectAccountState {
  const due = [...(account.requirements?.past_due ?? []), ...(account.requirements?.currently_due ?? [])];
  return {
    stripeAccountId: account.id,
    detailsSubmitted: account.details_submitted ?? false,
    payoutsEnabled: account.payouts_enabled ?? false,
    transfersActive: account.capabilities?.transfers === "active",
    requirementsDue: [...new Set(due)].sort(),
    disabledReason: account.requirements?.disabled_reason ?? null,
  };
}

/**
 * Where a creator stands:
 * - none: no account yet
 * - incomplete: onboarding not finished, or Stripe needs more information
 * - verifying: details are in and Stripe is checking them
 * - ready: we can send money and Stripe can pay it out to their bank
 * - disconnected: they removed our access in Stripe
 */
export type PayoutReadiness = "none" | "incomplete" | "verifying" | "ready" | "disconnected";

export function payoutReadiness(
  account: Pick<ConnectAccountState, "detailsSubmitted" | "payoutsEnabled" | "transfersActive" | "requirementsDue"> & { disconnectedAt?: Date | null } | null | undefined,
): PayoutReadiness {
  if (!account) return "none";
  if (account.disconnectedAt) return "disconnected";
  if (account.transfersActive && account.payoutsEnabled) return "ready";
  if (!account.detailsSubmitted || account.requirementsDue.length > 0) return "incomplete";
  return "verifying";
}

export const READINESS_LABEL: Record<PayoutReadiness, string> = {
  none: "Not set up",
  incomplete: "Needs information",
  verifying: "Being verified",
  ready: "Ready",
  disconnected: "Disconnected",
};
