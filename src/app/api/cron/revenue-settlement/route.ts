import { NextResponse } from "next/server";
import { authorizedCron } from "@/lib/cron";
import { getDb } from "@/lib/db";
import { monthPeriod } from "@/lib/revenue/pool";
import { settlePeriod } from "@/lib/revenue/settlement";

export const dynamic = "force-dynamic";

/**
 * Settles last month's creator pool, creating pending payouts. Safe to call again:
 * a settled month returns the stored result. Call on the 2nd of each month (a day's
 * margin for late invoice webhooks) with `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: Request) {
  if (!authorizedCron(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const now = new Date();
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const result = await settlePeriod(getDb(), monthPeriod(last.getUTCFullYear(), last.getUTCMonth() + 1));
  return NextResponse.json({
    period: last.toISOString().slice(0, 7),
    alreadySettled: result.alreadySettled,
    poolCents: result.poolCents,
    shares: result.shares.length,
    payouts: result.payouts.length,
  });
}
