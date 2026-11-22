/**
 * Add the local prices in src/lib/regions.ts to the two Stripe plan prices
 * (STRIPE_PRICE_MONTHLY, STRIPE_PRICE_ANNUAL) as currency options, with tax behavior.
 *
 *   npm run stripe:prices            # show what would change
 *   npm run stripe:prices -- --apply # change it
 */
import type { PlanId } from "@/lib/config";
import { planPriceSync, type StripePriceShape } from "@/lib/pricing-sync";
import { getStripe, priceIdFor } from "@/lib/stripe";

async function main() {
  const apply = process.argv.includes("--apply");
  const stripe = getStripe();
  let blocked = false;
  for (const plan of ["monthly", "annual"] as PlanId[]) {
    const price = await stripe.prices.retrieve(priceIdFor(plan), { expand: ["currency_options"] });
    const result = planPriceSync(price as unknown as StripePriceShape, plan);
    console.log(`\n${plan} (${price.id})`);
    for (const c of result.changes) console.log(`  ${c}`);
    for (const p of result.problems) console.log(`  PROBLEM: ${p}`);
    if (!result.changes.length && !result.problems.length) console.log("  Up to date.");
    if (result.problems.length) blocked = true;
    if (apply && result.update) {
      await stripe.prices.update(price.id, result.update);
      console.log("  Updated.");
    }
  }
  if (!apply) console.log("\nNothing changed. Run with --apply to update Stripe.");
  process.exit(blocked ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
