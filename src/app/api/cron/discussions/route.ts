import { NextResponse } from "next/server";
import { authorizedCron } from "@/lib/cron";
import { getDb } from "@/lib/db";
import { sendReplyNotice } from "@/lib/discussions/runtime";
import { getPostScreener } from "@/lib/discussions/screen";
import { screenPendingPosts } from "@/lib/discussions/service";

export const dynamic = "force-dynamic";

/** Runs the AI check on posts it couldn't check when they were written. Every 10 minutes (scripts/cron-tick.mjs). */
export async function GET(request: Request) {
  if (!authorizedCron(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const result = await screenPendingPosts(getDb(), getPostScreener());
  for (const id of result.publishedReplies) await sendReplyNotice(id);
  return NextResponse.json({ checked: result.checked, published: result.publishedReplies.length });
}
