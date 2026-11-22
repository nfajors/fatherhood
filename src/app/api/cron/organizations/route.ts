import { NextResponse } from "next/server";
import { authorizedCron } from "@/lib/cron";
import { getDb } from "@/lib/db";
import { syncAllOrganizations } from "@/lib/organizations/service";

export const dynamic = "force-dynamic";

/**
 * Brings every organization seat's access in line with its contracts (a contract
 * starting today, a renewal). Daily, with `Authorization: Bearer $CRON_SECRET`
 * (scripts/cron-tick.mjs does this).
 */
export async function GET(request: Request) {
  if (!authorizedCron(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await syncAllOrganizations(getDb()));
}
