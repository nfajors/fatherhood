/**
 * Bringing the Stripe prices in line with lib/regions.ts: each plan's price is in US
 * dollars, with a currency option per other currency at the local amount, and a tax
 * behavior (inclusive where prices include VAT/GST). Pure, so it can be checked
 * before anything changes in Stripe.
 */
import type { PlanId } from "@/lib/config";
import { PRICES, TAX_INCLUSIVE, type Currency } from "@/lib/regions";

type TaxBehavior = "inclusive" | "exclusive" | "unspecified";

export type StripePriceShape = {
  id: string;
  currency: string;
  unit_amount: number | null;
  tax_behavior: TaxBehavior | null;
  currency_options?: Record<string, { unit_amount: number | null; tax_behavior: TaxBehavior | null }> | null;
};

export type PricePlan = {
  priceId: string;
  /** Parameters for stripe.prices.update, or null when nothing needs changing. */
  update: { tax_behavior?: "inclusive" | "exclusive"; currency_options?: Record<string, { unit_amount: number; tax_behavior: "inclusive" | "exclusive" }> } | null;
  changes: string[];
  /** Things the script can't fix (a new Stripe price is needed); nothing is changed while any remain. */
  problems: string[];
};

const behavior = (c: Currency): "inclusive" | "exclusive" => (TAX_INCLUSIVE[c] ? "inclusive" : "exclusive");
const money = (c: string, minor: number) => `${c.toUpperCase()} ${(minor / 100).toFixed(2)}`;

export function planPriceSync(price: StripePriceShape, plan: PlanId): PricePlan {
  const changes: string[] = [];
  const problems: string[] = [];
  const update: NonNullable<PricePlan["update"]> = {};

  if (price.currency !== "usd") problems.push(`${price.id} is in ${price.currency.toUpperCase()}; the plan prices must be US-dollar prices.`);
  if (price.unit_amount !== PRICES.usd[plan]) {
    problems.push(`${price.id} charges ${money("usd", price.unit_amount ?? 0)} but lib/regions.ts says ${money("usd", PRICES.usd[plan])}. A price's amount can't change: create a new price in Stripe and update STRIPE_PRICE_${plan.toUpperCase()}.`);
  }
  const usdBehavior = price.tax_behavior ?? "unspecified";
  if (usdBehavior === "unspecified") {
    update.tax_behavior = behavior("usd");
    changes.push(`Set tax behavior to ${behavior("usd")} for USD`);
  } else if (usdBehavior !== behavior("usd")) {
    problems.push(`${price.id} is tax-${usdBehavior} in USD; it should be ${behavior("usd")}. Create a new price.`);
  }

  const desired: Record<string, { unit_amount: number; tax_behavior: "inclusive" | "exclusive" }> = {};
  let optionsChanged = false;
  for (const currency of Object.keys(PRICES) as Currency[]) {
    if (currency === "usd") continue;
    const want = { unit_amount: PRICES[currency][plan], tax_behavior: behavior(currency) };
    desired[currency] = want;
    const have = price.currency_options?.[currency];
    if (!have) {
      optionsChanged = true;
      changes.push(`Add ${money(currency, want.unit_amount)} (${want.tax_behavior})`);
    } else {
      if (have.unit_amount !== want.unit_amount) {
        optionsChanged = true;
        changes.push(`Change ${currency.toUpperCase()} from ${money(currency, have.unit_amount ?? 0)} to ${money(currency, want.unit_amount)}`);
      }
      if (have.tax_behavior && have.tax_behavior !== "unspecified" && have.tax_behavior !== want.tax_behavior) {
        problems.push(`${price.id} is tax-${have.tax_behavior} in ${currency.toUpperCase()}; it should be ${want.tax_behavior}. Create a new price.`);
      } else if (!have.tax_behavior || have.tax_behavior === "unspecified") {
        optionsChanged = true;
        changes.push(`Set tax behavior to ${want.tax_behavior} for ${currency.toUpperCase()}`);
      }
    }
  }
  // Sent as a complete set so currencies already there stay.
  if (optionsChanged) update.currency_options = desired;
  return { priceId: price.id, update: Object.keys(update).length && problems.length === 0 ? update : null, changes, problems };
}
