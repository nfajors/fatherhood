import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { updatePreferences } from "@/lib/emails/preferences";
import { verifyEmailToken } from "@/lib/emails/tokens";

const body = z.object({
  token: z.string().max(400).optional(),
  learning: z.boolean().optional(),
  announcements: z.boolean().optional(),
  replies: z.boolean().optional(),
});

/** Change email settings: signed in, or with the signed token from an email's footer. */
export async function PUT(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const { token, ...changes } = parsed.data;
  const userId = token ? verifyEmailToken(token) : ((await getSessionUser())?.id ?? null);
  if (!userId) return NextResponse.json({ error: token ? "invalid_link" : "sign_in_required" }, { status: token ? 400 : 401 });
  return NextResponse.json({ preferences: await updatePreferences(getDb(), userId, changes) });
}
