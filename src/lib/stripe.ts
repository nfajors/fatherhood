/**
 * Stripe client and the mapping from Stripe objects to our `subscriptions` rows.
 */
import Stripe from "stripe";
import type { PlanId } from "@/lib/config";
import type { SubscriptionStatus } from "@/lib/db/schema";
import { stripeEnv } from "@/lib/env";

let client: Stripe | undefined;

export function getStripe(): Stripe {
  client ??= new Stripe(stripeEnv().STRIPE_SECRET_KEY, { typescript: true });
  return client;
}

export function priceIdFor(plan: PlanId): string {
  const env = stripeEnv();
  return plan === "annual" ? env.STRIPE_PRICE_ANNUAL : env.STRIPE_PRICE_MONTHLY;
}

export function planForPriceId(priceId: string | undefined, prices: { monthly: string; annual: string }): PlanId | null {
  if (priceId === prices.annual) return "annual";
  if (priceId === prices.monthly) return "monthly";
  return null;
}

export type SubscriptionRecord = {
  userId: string;
  plan: PlanId;
  status: SubscriptionStatus;
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  stripePriceId: string;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
};

/**
 * Convert a Stripe subscription into our row. The user id comes from the
 * metadata set at checkout. Returns null for subscriptions that are not ours
 * (no user id or an unknown price), which the webhook ignores.
 */
export function toSubscriptionRecord(
  sub: Stripe.Subscription,
  prices: { monthly: string; annual: string },
): SubscriptionRecord | null {
  const userId = sub.metadata?.userId;
  const item = sub.items.data[0];
  const priceId = item?.price.id;
  const plan = planForPriceId(priceId, prices);
  if (!userId || !item || !priceId || !plan) return null;

  // Since API version 2025-03-31 the billing period lives on each item.
  const legacy = sub as Stripe.Subscription & { current_period_end?: number };
  const periodEnd = item.current_period_end ?? legacy.current_period_end;
  if (!periodEnd) return null;

  return {
    userId,
    plan,
    status: sub.status as SubscriptionStatus,
    stripeSubscriptionId: sub.id,
    stripeCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    stripePriceId: priceId,
    currentPeriodEnd: new Date(periodEnd * 1000),
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  };
}

export type LedgerEntry = {
  stripeInvoiceId: string;
  stripeCustomerId: string;
  amountCents: number;
  paidAt: Date;
};

/**
 * Revenue-ledger entry for a paid subscription invoice, or null for invoices
 * that are not subscription revenue (one-off invoices, $0 invoices).
 */
export function toLedgerEntry(invoice: Stripe.Invoice): LedgerEntry | null {
  if (!invoice.id || !invoice.billing_reason?.startsWith("subscription")) return null;
  if (invoice.amount_paid <= 0 || !invoice.customer) return null;
  const paidAt = invoice.status_transitions?.paid_at ?? invoice.created;
  return {
    stripeInvoiceId: invoice.id,
    stripeCustomerId: typeof invoice.customer === "string" ? invoice.customer : invoice.customer.id,
    amountCents: invoice.amount_paid,
    paidAt: new Date(paidAt * 1000),
  };
}
