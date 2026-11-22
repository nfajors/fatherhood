import { NextResponse } from "next/server";
import { authorizedCron } from "@/lib/cron";
import { getDb } from "@/lib/db";
import { autoSendEnabled, payoutNotifier, stripePayouts } from "@/lib/payouts/runtime";
import { runPayouts } from "@/lib/payouts/service";

export const dynamic = "force-dynamic";

/**
 * Asks creators with a waiting payout to set up their payout account, and (with
 * PAYOUTS_AUTO_SEND=true) sends pending payouts past their hold. Call daily with
 * `Authorization: Bearer $CRON_SECRET` (scripts/cron-tick.mjs does this).
 */
export async function GET(request: Request) {
  if (!authorizedCron(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const autoSend = autoSendEnabled();
  const result = await runPayouts(getDb(), stripePayouts, { autoSend, notifier: payoutNotifier() });
  return NextResponse.json({ autoSend, ...result });
}
