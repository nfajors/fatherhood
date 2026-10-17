import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getMailer } from "@/lib/email";
import { appUrl } from "@/lib/env";
import { deliverDueGifts } from "@/lib/gifts/service";

export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Sends scheduled gift emails whose date has come, and retries failed sends.
 * Call hourly with `Authorization: Bearer $CRON_SECRET` (vercel.json does this on Vercel).
 */
export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const result = await deliverDueGifts(getDb(), getMailer(), appUrl());
  return NextResponse.json({ delivered: result.delivered.length, failed: result.failed.length });
}
