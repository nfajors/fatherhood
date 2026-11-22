import { describe, expect, it } from "vitest";
import { planPriceSync } from "./pricing-sync";

describe("planPriceSync", () => {
  it("adds every local price and the tax behavior to a plain US price", () => {
    const plan = planPriceSync({ id: "price_m", currency: "usd", unit_amount: 19_00, tax_behavior: "unspecified", currency_options: null }, "monthly");
    expect(plan.problems).toEqual([]);
    expect(plan.update).toEqual({
      tax_behavior: "exclusive",
      currency_options: {
        gbp: { unit_amount: 15_00, tax_behavior: "inclusive" },
        eur: { unit_amount: 17_00, tax_behavior: "inclusive" },
        cad: { unit_amount: 25_00, tax_behavior: "exclusive" },
        aud: { unit_amount: 29_00, tax_behavior: "inclusive" },
        nzd: { unit_amount: 32_00, tax_behavior: "inclusive" },
      },
    });
    expect(plan.changes).toContain("Add GBP 15.00 (inclusive)");
  });

  it("does nothing when Stripe already matches", () => {
    const options = {
      gbp: { unit_amount: 159_00, tax_behavior: "inclusive" as const },
      eur: { unit_amount: 179_00, tax_behavior: "inclusive" as const },
      cad: { unit_amount: 259_00, tax_behavior: "exclusive" as const },
      aud: { unit_amount: 299_00, tax_behavior: "inclusive" as const },
      nzd: { unit_amount: 329_00, tax_behavior: "inclusive" as const },
    };
    expect(planPriceSync({ id: "price_a", currency: "usd", unit_amount: 199_00, tax_behavior: "exclusive", currency_options: options }, "annual")).toEqual({
      priceId: "price_a",
      update: null,
      changes: [],
      problems: [],
    });
  });

  it("changes a local amount, and refuses what needs a new price", () => {
    const changed = planPriceSync(
      { id: "price_a", currency: "usd", unit_amount: 199_00, tax_behavior: "exclusive", currency_options: { gbp: { unit_amount: 149_00, tax_behavior: "inclusive" } } },
      "annual",
    );
    expect(changed.changes).toContain("Change GBP from GBP 149.00 to GBP 159.00");
    expect(changed.update?.currency_options?.gbp).toEqual({ unit_amount: 159_00, tax_behavior: "inclusive" });

    const wrong = planPriceSync({ id: "price_m", currency: "usd", unit_amount: 20_00, tax_behavior: "inclusive", currency_options: null }, "monthly");
    expect(wrong.update).toBeNull();
    expect(wrong.problems).toHaveLength(2);
    expect(wrong.problems[0]).toContain("create a new price in Stripe");
  });
});
