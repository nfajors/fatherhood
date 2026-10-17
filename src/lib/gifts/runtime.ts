/** Production wiring for gifts: Stripe billing credits and post-payment fulfilment. */
import type Stripe from "stripe";
import { getDb } from "@/lib/db";
import { getMailer } from "@/lib/email";
import { appUrl } from "@/lib/env";
import { getStripe } from "@/lib/stripe";
import { deliverDueGifts, markGiftPaid, sendPurchaserConfirmation, type BillingCredits, type Gift } from "./service";

export const stripeCredits: BillingCredits = {
  async adjust(customerId, amountCents, description, idempotencyKey) {
    const txn = await getStripe().customers.createBalanceTransaction(
      customerId,
      { amount: amountCents, currency: "usd", description },
      { idempotencyKey },
    );
    return txn.id;
  },
};

/** True for a completed Checkout session that paid for a gift. */
export function isPaidGiftCheckout(session: Stripe.Checkout.Session): boolean {
  return session.metadata?.kind === "gift" && Boolean(session.metadata.giftId) && session.payment_status === "paid";
}

/**
 * Mark a gift paid from its Checkout session. Called from the webhook and from
 * the thank-you page, whichever sees the payment first. Returns the gift only
 * to the first caller, which should then call sendGiftEmails.
 */
export async function recordGiftPayment(session: Stripe.Checkout.Session): Promise<Gift | null> {
  if (!isPaidGiftCheckout(session)) return null;
  return markGiftPaid(getDb(), {
    giftId: session.metadata!.giftId!,
    checkoutSessionId: session.id,
    paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null),
    amountPaidCents: session.amount_total ?? 0,
    paidAt: new Date(),
  });
}

/** Purchaser confirmation, then recipient delivery if it's due now. Failures are logged; delivery retries on the next run. */
export async function sendGiftEmails(gift: Gift): Promise<void> {
  const mailer = getMailer();
  try {
    await sendPurchaserConfirmation(gift, mailer, appUrl());
  } catch (error) {
    console.error(`Gift ${gift.id}: purchaser confirmation failed`, error);
  }
  try {
    await deliverDueGifts(getDb(), mailer, appUrl());
  } catch (error) {
    console.error(`Gift ${gift.id}: delivery run failed`, error);
  }
}
