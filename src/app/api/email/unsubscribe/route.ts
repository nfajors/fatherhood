import { NextResponse } from "next/server";
import { z } from "zod";
import { emailCategory } from "@/lib/db/schema";
import { getDb } from "@/lib/db";
import { unsubscribe } from "@/lib/emails/preferences";
import { verifyEmailToken } from "@/lib/emails/tokens";

const category = z.enum([...emailCategory.enumValues, "all"]);

/**
 * One-click unsubscribe (RFC 8058): mail clients POST here from the
 * List-Unsubscribe header with no sign-in. Also used by the unsubscribe page.
 * GET is deliberately not supported, so link scanners can't unsubscribe anyone.
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const userId = verifyEmailToken(url.searchParams.get("t"));
  const parsed = category.safeParse(url.searchParams.get("c") ?? "all");
  if (!userId || !parsed.success) return NextResponse.json({ error: "invalid_link" }, { status: 400 });
  const preferences = await unsubscribe(getDb(), userId, parsed.data);
  return NextResponse.json({ preferences });
}
