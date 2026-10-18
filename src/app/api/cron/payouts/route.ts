import { NextResponse } from "next/server";
import { authorizedCron } from "@/lib/cron";
import { runPayoutJob } from "@/lib/payouts/runtime";

export const dynamic = "force-dynamic";

/**
 * Daily: settles last month (from the 5th), reminds creators to set up payouts,
 * and sends payouts when PAYOUTS_AUTO_SEND=true.
 * Call with `Authorization: Bearer $CRON_SECRET` (vercel.json does this on Vercel).
 */
export async function GET(request: Request) {
  if (!authorizedCron(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await runPayoutJob());
}
