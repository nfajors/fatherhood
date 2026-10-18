import { NextResponse } from "next/server";
import { authorizedCron } from "@/lib/cron";
import { getDb } from "@/lib/db";
import { getMailer } from "@/lib/email";
import { runEmailSequences } from "@/lib/emails/engine";
import { postalAddress } from "@/lib/emails/runtime";
import { appUrl } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Enrolls people in email sequences and sends what's due.
 * Call every 15 minutes with `Authorization: Bearer $CRON_SECRET` (vercel.json does this on Vercel).
 */
export async function GET(request: Request) {
  if (!authorizedCron(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await runEmailSequences(getDb(), getMailer(), { appUrl: appUrl(), postalAddress: postalAddress() }));
}
