import { NextResponse } from "next/server";
import { authorizedCron } from "@/lib/cron";
import { getDb } from "@/lib/db";
import { getMailer } from "@/lib/email";
import { getScreener, streamMedia } from "@/lib/moderation/runtime";
import { screenPendingVideos } from "@/lib/moderation/service";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Finish AI screens for queued videos whose captions are ready. Run every 10 minutes. */
export async function GET(request: Request) {
  if (!authorizedCron(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const screener = getScreener();
  if (!screener) return NextResponse.json({ skipped: "screener_not_configured" });
  const result = await screenPendingVideos(getDb(), { media: streamMedia, screener, mailer: getMailer() });
  return NextResponse.json({ ...result, failed: result.failed.length });
}
