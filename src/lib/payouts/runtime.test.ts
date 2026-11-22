import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { isRetryableStripeError } from "./runtime";

const stripeError = (type: string, code?: string) => Stripe.errors.StripeError.generate({ type, code, message: "x" } as never);

describe("isRetryableStripeError", () => {
  it("retries outages, rate limits and a platform balance that isn't available yet", () => {
    expect(isRetryableStripeError(stripeError("api_error"))).toBe(true);
    expect(isRetryableStripeError(stripeError("invalid_request_error", "balance_insufficient"))).toBe(true);
    expect(isRetryableStripeError(new Error("socket hang up"))).toBe(true);
  });

  it("does not retry a refused transfer", () => {
    expect(isRetryableStripeError(stripeError("invalid_request_error", "account_invalid"))).toBe(false);
  });
});
