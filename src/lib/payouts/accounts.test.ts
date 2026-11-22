import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { payoutReadiness, toAccountState } from "./accounts";

const account = (overrides: Partial<Stripe.Account> = {}) =>
  ({
    id: "acct_1",
    details_submitted: false,
    payouts_enabled: false,
    capabilities: { transfers: "inactive" },
    requirements: { currently_due: ["external_account", "individual.ssn_last_4"], past_due: ["external_account"], disabled_reason: "requirements.past_due" },
    ...overrides,
  }) as unknown as Stripe.Account;

describe("toAccountState", () => {
  it("keeps what we need, with requirements deduplicated", () => {
    expect(toAccountState(account())).toEqual({
      stripeAccountId: "acct_1",
      detailsSubmitted: false,
      payoutsEnabled: false,
      transfersActive: false,
      requirementsDue: ["external_account", "individual.ssn_last_4"],
      disabledReason: "requirements.past_due",
    });
  });

  it("reads an active transfers capability", () => {
    const state = toAccountState(account({ details_submitted: true, payouts_enabled: true, capabilities: { transfers: "active" }, requirements: undefined }));
    expect(state).toMatchObject({ transfersActive: true, payoutsEnabled: true, requirementsDue: [], disabledReason: null });
  });
});

describe("payoutReadiness", () => {
  const base = { detailsSubmitted: true, payoutsEnabled: true, transfersActive: true, requirementsDue: [] as string[] };
  it("walks through each state", () => {
    expect(payoutReadiness(null)).toBe("none");
    expect(payoutReadiness({ ...base, detailsSubmitted: false, payoutsEnabled: false, transfersActive: false })).toBe("incomplete");
    expect(payoutReadiness({ ...base, payoutsEnabled: false, requirementsDue: ["external_account"] })).toBe("incomplete");
    expect(payoutReadiness({ ...base, transfersActive: false })).toBe("verifying");
    expect(payoutReadiness(base)).toBe("ready");
    expect(payoutReadiness({ ...base, disconnectedAt: new Date() })).toBe("disconnected");
  });

  it("is ready while Stripe lists future requirements, as long as money can move", () => {
    expect(payoutReadiness({ ...base, requirementsDue: ["individual.verification.document"] })).toBe("ready");
  });
});
