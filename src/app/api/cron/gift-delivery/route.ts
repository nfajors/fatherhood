import { NextResponse } from "next/server";
import { authorizedCron } from "@/lib/cron";
import { getDb } from "@/lib/db";
import { getMailer } from "@/lib/email";
import { appUrl } from "@/lib/env";
import { deliverDueGifts } from "@/lib/gifts/service";

export const dynamic = "force-dynamic";

/**
 * Sends scheduled gift emails whose date has come, and retries failed sends.
 * Call hourly with `Authorization: Bearer $CRON_SECRET` (vercel.json does this on Vercel).
 */
export async function GET(request: Request) {
  if (!authorizedCron(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const result = await deliverDueGifts(getDb(), getMailer(), appUrl());
  return NextResponse.json({ delivered: result.delivered.length, failed: result.failed.length });
}
