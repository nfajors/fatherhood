/** Production wiring for payouts: Stripe Connect and creator emails. */
import Stripe from "stripe";
import { getMailer } from "@/lib/email";
import { appUrl } from "@/lib/env";
import { getStripe } from "@/lib/stripe";
import { toAccountState } from "./accounts";
import { PAYOUT_POLICY } from "./policy";
import { TransferError, type PayoutGateway, type PayoutNotifier } from "./service";

/** Temporary failures worth trying again later: Stripe outages, rate limits, platform balance not yet available. */
export function isRetryableStripeError(error: unknown): boolean {
  if (!(error instanceof Stripe.errors.StripeError)) return true;
  if (error.type === "StripeConnectionError" || error.type === "StripeAPIError" || error.type === "StripeRateLimitError") return true;
  return error.code === "balance_insufficient" || error.code === "lock_timeout";
}

export const stripePayouts: PayoutGateway = {
  async createAccount({ userId, email, idempotencyKey }) {
    const account = await getStripe().accounts.create(
      {
        type: "express",
        country: PAYOUT_POLICY.accountCountry,
        email,
        business_type: "individual",
        capabilities: { transfers: { requested: true } },
        business_profile: { product_description: "Videos for fathers published on Fatherhood.School Community Voices" },
        metadata: { userId },
      },
      { idempotencyKey },
    );
    return toAccountState(account);
  },

  async retrieveAccount(stripeAccountId) {
    return toAccountState(await getStripe().accounts.retrieve(stripeAccountId));
  },

  async onboardingLink(stripeAccountId, { returnUrl, refreshUrl }) {
    const link = await getStripe().accountLinks.create({
      account: stripeAccountId,
      type: "account_onboarding",
      return_url: returnUrl,
      refresh_url: refreshUrl,
      collection_options: { fields: "currently_due" },
    });
    return link.url;
  },

  async dashboardLink(stripeAccountId) {
    return (await getStripe().accounts.createLoginLink(stripeAccountId)).url;
  },

  async findTransfer(payoutId) {
    const transfers = await getStripe().transfers.list({ transfer_group: payoutId, limit: 10 });
    const live = transfers.data.find((t) => !t.reversed) ?? transfers.data[0];
    return live ? { id: live.id, reversed: live.reversed } : null;
  },

  async createTransfer({ payoutId, stripeAccountId, amountCents, description, idempotencyKey }) {
    try {
      const transfer = await getStripe().transfers.create(
        {
          amount: amountCents,
          currency: PAYOUT_POLICY.currency,
          destination: stripeAccountId,
          transfer_group: payoutId,
          description,
          metadata: { payoutId },
        },
        { idempotencyKey },
      );
      return { id: transfer.id };
    } catch (error) {
      throw new TransferError(error instanceof Error ? error.message : String(error), isRetryableStripeError(error));
    }
  },
};

export function payoutNotifier(): PayoutNotifier {
  return { mailer: getMailer(), earningsUrl: `${appUrl()}/studio/earnings` };
}

/** Automatic sending is off until PAYOUTS_AUTO_SEND=true; admins can always send from /admin/payouts. */
export function autoSendEnabled(): boolean {
  return process.env.PAYOUTS_AUTO_SEND === "true";
}

/** The Connect webhook (account.updated) has its own signing secret. */
export function connectWebhookSecret(): string | null {
  return process.env.STRIPE_CONNECT_WEBHOOK_SECRET || null;
}
