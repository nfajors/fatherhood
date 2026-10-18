/**
 * Settle the creator revenue pool for one month.
 *
 *   npm run revenue:settle              # previous calendar month
 *   npm run revenue:settle -- 2026-10   # a specific month
 *   npm run revenue:settle -- 2026-10 --force   # recalculate (refused once its payouts were sent or tried)
 */
import { getDb } from "@/lib/db";
import { monthPeriod } from "@/lib/revenue/pool";
import { settlePeriod } from "@/lib/revenue/settlement";

function parseMonth(arg: string | undefined): { year: number; month: number } {
  if (!arg) {
    const now = new Date();
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    return { year: prev.getUTCFullYear(), month: prev.getUTCMonth() + 1 };
  }
  const match = /^(\d{4})-(\d{2})$/.exec(arg);
  const month = Number(match?.[2]);
  if (!match || month < 1 || month > 12) throw new Error(`Expected YYYY-MM, got "${arg}"`);
  return { year: Number(match[1]), month };
}

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

async function main() {
  const args = process.argv.slice(2);
  const { year, month } = parseMonth(args.find((a) => !a.startsWith("--")));
  const result = await settlePeriod(getDb(), monthPeriod(year, month), { force: args.includes("--force") });

  console.log(`Period ${year}-${String(month).padStart(2, "0")}${result.alreadySettled ? " (already settled)" : ""}`);
  console.log(`Subscription revenue ${dollars(result.subscriptionRevenueCents)}, creator pool ${dollars(result.poolCents)}`);
  for (const s of result.shares) console.log(`  share   ${s.creatorId}  ${dollars(s.amountCents)}`);
  for (const p of result.payouts) console.log(`  payout  ${p.creatorId}  ${dollars(p.amountCents)}`);
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  if (error instanceof Error && error.cause) console.error("Caused by:", error.cause);
  process.exit(1);
});
