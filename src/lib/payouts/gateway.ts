/**
 * The Stripe Connect calls payouts need, behind an interface so the payout
 * logic can be tested without Stripe. Creators get Express accounts: Stripe
 * hosts onboarding (identity, bank, tax forms) and their payout dashboard.
 */
import type Stripe from "stripe";

export type AccountState = {
  id: string;
  detailsSubmitted: boolean;
  payoutsEnabled: boolean;
  /** What Stripe still needs, currently due first. */
  requirementsDue: string[];
  disabledReason: string | null;
  country: string | null;
};

export type TransferRequest = {
  amountCents: number;
  destination: string;
  /** One group per payout: lets a retry find a transfer an earlier attempt already made. */
  group: string;
  description: string;
  metadata: Record<string, string>;
  idempotencyKey: string;
};

export interface ConnectGateway {
  createAccount(input: { userId: string; email: string; country: string }): Promise<AccountState>;
  retrieveAccount(accountId: string): Promise<AccountState>;
  onboardingLink(accountId: string, urls: { refreshUrl: string; returnUrl: string }): Promise<string>;
  dashboardLink(accountId: string): Promise<string>;
  findTransfer(group: string): Promise<{ id: string } | null>;
  createTransfer(request: TransferRequest): Promise<{ id: string }>;
  /** The platform's available USD balance: transfers can't exceed it. */
  availableBalanceCents(): Promise<number>;
}

export function toAccountState(account: Stripe.Account): AccountState {
  const req = account.requirements;
  return {
    id: account.id,
    detailsSubmitted: account.details_submitted ?? false,
    payoutsEnabled: account.payouts_enabled ?? false,
    requirementsDue: [...new Set([...(req?.past_due ?? []), ...(req?.currently_due ?? [])])],
    disabledReason: req?.disabled_reason ?? null,
    country: account.country ?? null,
  };
}

/** Why a transfer failed, in words an admin can act on. */
export function transferFailureReason(error: unknown): string {
  const e = error as { code?: string; message?: string; type?: string };
  switch (e?.code) {
    case "balance_insufficient":
      return "Not enough available balance in the Stripe account yet. It will be retried.";
    case "account_invalid":
    case "no_account":
      return "The creator's Stripe account can't receive transfers right now.";
    default:
      return e?.message ? `Stripe: ${e.message}` : "The transfer failed.";
  }
}

export class StripeConnectGateway implements ConnectGateway {
  constructor(private readonly stripe: Stripe) {}

  async createAccount({ userId, email, country }: { userId: string; email: string; country: string }) {
    const account = await this.stripe.accounts.create(
      {
        type: "express",
        country,
        email,
        business_type: "individual",
        // Creators only receive transfers; they don't take payments.
        capabilities: { transfers: { requested: true } },
        metadata: { userId, platform: "fatherhood_school" },
      },
      // One account per person even if they double-click.
      { idempotencyKey: `connect-account-${userId}` },
    );
    return toAccountState(account);
  }

  async retrieveAccount(accountId: string) {
    return toAccountState(await this.stripe.accounts.retrieve(accountId));
  }

  async onboardingLink(accountId: string, urls: { refreshUrl: string; returnUrl: string }) {
    const link = await this.stripe.accountLinks.create({
      account: accountId,
      type: "account_onboarding",
      refresh_url: urls.refreshUrl,
      return_url: urls.returnUrl,
    });
    return link.url;
  }

  async dashboardLink(accountId: string) {
    return (await this.stripe.accounts.createLoginLink(accountId)).url;
  }

  async findTransfer(group: string) {
    const { data } = await this.stripe.transfers.list({ transfer_group: group, limit: 1 });
    return data[0] ? { id: data[0].id } : null;
  }

  async createTransfer(request: TransferRequest) {
    const transfer = await this.stripe.transfers.create(
      {
        amount: request.amountCents,
        currency: "usd",
        destination: request.destination,
        transfer_group: request.group,
        description: request.description,
        metadata: request.metadata,
      },
      { idempotencyKey: request.idempotencyKey },
    );
    return { id: transfer.id };
  }

  async availableBalanceCents() {
    const balance = await this.stripe.balance.retrieve();
    return balance.available.filter((b) => b.currency === "usd").reduce((sum, b) => sum + b.amount, 0);
  }
}
