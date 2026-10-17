import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { planForPriceId, toSubscriptionRecord } from "./stripe";

const prices = { monthly: "price_monthly", annual: "price_annual" };

function subscription(overrides: Partial<Record<string, unknown>> = {}, itemOverrides: Record<string, unknown> = {}) {
  return {
    id: "sub_1",
    status: "active",
    customer: "cus_1",
    cancel_at_period_end: false,
    metadata: { userId: "user-1" },
    items: { data: [{ price: { id: "price_annual" }, current_period_end: 1_800_000_000, ...itemOverrides }] },
    ...overrides,
  } as unknown as Stripe.Subscription;
}

describe("planForPriceId", () => {
  it("maps configured prices and rejects unknown ones", () => {
    expect(planForPriceId("price_annual", prices)).toBe("annual");
    expect(planForPriceId("price_monthly", prices)).toBe("monthly");
    expect(planForPriceId("price_other", prices)).toBeNull();
    expect(planForPriceId(undefined, prices)).toBeNull();
  });
});

describe("toSubscriptionRecord", () => {
  it("maps a current-API subscription (period on the item)", () => {
    expect(toSubscriptionRecord(subscription(), prices)).toEqual({
      userId: "user-1",
      plan: "annual",
      status: "active",
      stripeSubscriptionId: "sub_1",
      stripeCustomerId: "cus_1",
      stripePriceId: "price_annual",
      currentPeriodEnd: new Date(1_800_000_000 * 1000),
      cancelAtPeriodEnd: false,
    });
  });

  it("falls back to the legacy top-level period and expanded customer", () => {
    const sub = subscription(
      { current_period_end: 1_700_000_000, customer: { id: "cus_9" }, cancel_at_period_end: true, status: "past_due" },
      { current_period_end: undefined, price: { id: "price_monthly" } },
    );
    expect(toSubscriptionRecord(sub, prices)).toMatchObject({
      plan: "monthly",
      status: "past_due",
      stripeCustomerId: "cus_9",
      currentPeriodEnd: new Date(1_700_000_000 * 1000),
      cancelAtPeriodEnd: true,
    });
  });

  it("ignores subscriptions without our user id, items, a known price or a period", () => {
    expect(toSubscriptionRecord(subscription({ metadata: {} }), prices)).toBeNull();
    expect(toSubscriptionRecord(subscription({ items: { data: [] } }), prices)).toBeNull();
    expect(toSubscriptionRecord(subscription({}, { price: { id: "price_other" } }), prices)).toBeNull();
    expect(toSubscriptionRecord(subscription({}, { current_period_end: undefined }), prices)).toBeNull();
  });
});
