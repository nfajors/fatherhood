import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { payoutSentEmail, payoutSetupEmail } from "./emails";
import { StripeConnectGateway, toAccountState, transferFailureReason } from "./gateway";
import { payoutState } from "./service";

describe("toAccountState", () => {
  it("keeps what payouts need from a Stripe account", () => {
    const account = {
      id: "acct_1",
      details_submitted: true,
      payouts_enabled: false,
      country: "US",
      requirements: { past_due: ["external_account"], currently_due: ["external_account", "individual.verification.document"], disabled_reason: "requirements.past_due" },
    } as unknown as Stripe.Account;
    expect(toAccountState(account)).toEqual({
      id: "acct_1",
      detailsSubmitted: true,
      payoutsEnabled: false,
      requirementsDue: ["external_account", "individual.verification.document"],
      disabledReason: "requirements.past_due",
      country: "US",
    });
    expect(toAccountState({ id: "acct_2" } as Stripe.Account)).toMatchObject({ detailsSubmitted: false, payoutsEnabled: false, requirementsDue: [] });
  });
});

describe("transferFailureReason", () => {
  it("explains common Stripe errors", () => {
    expect(transferFailureReason({ code: "balance_insufficient", message: "x" })).toMatch(/Not enough available balance/);
    expect(transferFailureReason({ code: "other", message: "Something odd" })).toBe("Stripe: Something odd");
    expect(transferFailureReason(null)).toBe("The transfer failed.");
  });
});

describe("StripeConnectGateway", () => {
  function fakeStripe() {
    return {
      accounts: {
        create: vi.fn().mockResolvedValue({ id: "acct_new", details_submitted: false, payouts_enabled: false }),
        retrieve: vi.fn(),
        createLoginLink: vi.fn().mockResolvedValue({ url: "https://connect.stripe.com/express/x" }),
      },
      accountLinks: { create: vi.fn().mockResolvedValue({ url: "https://connect.stripe.com/setup/x" }) },
      transfers: { create: vi.fn().mockResolvedValue({ id: "tr_1" }), list: vi.fn().mockResolvedValue({ data: [] }) },
      balance: { retrieve: vi.fn().mockResolvedValue({ available: [{ currency: "usd", amount: 1234 }, { currency: "eur", amount: 99 }] }) },
    };
  }

  it("creates transfer-only Express accounts, once per person", async () => {
    const stripe = fakeStripe();
    const gateway = new StripeConnectGateway(stripe as unknown as Stripe);
    await gateway.createAccount({ userId: "u1", email: "dad@example.com", country: "US" });
    expect(stripe.accounts.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: "express", country: "US", email: "dad@example.com", capabilities: { transfers: { requested: true } }, metadata: expect.objectContaining({ userId: "u1" }) }),
      { idempotencyKey: "connect-account-u1" },
    );
    expect(await gateway.onboardingLink("acct_new", { refreshUrl: "r", returnUrl: "s" })).toBe("https://connect.stripe.com/setup/x");
    expect(stripe.accountLinks.create).toHaveBeenCalledWith({ account: "acct_new", type: "account_onboarding", refresh_url: "r", return_url: "s" });
  });

  it("sends USD transfers in the payout's group with its idempotency key", async () => {
    const stripe = fakeStripe();
    const gateway = new StripeConnectGateway(stripe as unknown as Stripe);
    expect(await gateway.findTransfer("payout_1")).toBeNull();
    expect(stripe.transfers.list).toHaveBeenCalledWith({ transfer_group: "payout_1", limit: 1 });
    await gateway.createTransfer({ amountCents: 2500, destination: "acct_1", group: "payout_1", description: "d", metadata: { payoutId: "1" }, idempotencyKey: "payout_1_attempt_1" });
    expect(stripe.transfers.create).toHaveBeenCalledWith(
      { amount: 2500, currency: "usd", destination: "acct_1", transfer_group: "payout_1", description: "d", metadata: { payoutId: "1" } },
      { idempotencyKey: "payout_1_attempt_1" },
    );
    expect(await gateway.availableBalanceCents()).toBe(1234);
  });
});

describe("payoutState", () => {
  const row = (status: "pending" | "processing" | "paid" | "failed", attempts = 0, accountReady = true, accountStarted = true) => ({ accountReady, accountStarted, payout: { status, attempts } });
  it("says what each payout is waiting on", () => {
    expect(payoutState(row("pending"))).toBe("ready");
    expect(payoutState(row("pending", 0, false, false))).toBe("needs_account");
    expect(payoutState(row("pending", 0, false, true))).toBe("account_incomplete");
    expect(payoutState(row("failed", 2))).toBe("retrying");
    expect(payoutState(row("failed", 5))).toBe("failed");
    expect(payoutState(row("processing", 1))).toBe("sending");
    expect(payoutState(row("paid", 1))).toBe("paid");
  });
});

describe("payout emails", () => {
  it("escape names and carry the amount", () => {
    const sent = payoutSentEmail({ to: "a@b.c", name: "<Sam> Jones", amountCents: 2500, earningsUrl: "https://x/studio/earnings", idempotencyKey: "k" });
    expect(sent.subject).toBe("You've been paid $25.00");
    expect(sent.html).toContain("Hi &lt;Sam&gt;,");
    expect(sent.idempotencyKey).toBe("k");
    const setup = payoutSetupEmail({ to: "a@b.c", name: "Sam", amountCents: 4000, earningsUrl: "https://x/studio/earnings#payouts" });
    expect(setup.subject).toBe("Set up payouts to receive $40.00");
    expect(setup.text).toContain("Set up payouts: https://x/studio/earnings#payouts");
  });
});
