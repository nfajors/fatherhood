import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser, type SessionUser } from "@/lib/auth";
import { DiscussionError } from "@/lib/discussions/service";

const STATUS: Record<DiscussionError["reason"], number> = { not_found: 404, not_allowed: 403, invalid: 400, rate_limited: 429, not_yours: 403 };

export const uuid = z.uuid();

/** Run a discussions handler for someone signed in; discussion errors become 4xx with their message. */
export async function asSignedIn(handler: (user: SessionUser) => Promise<Response>): Promise<Response> {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return NextResponse.json({ error: "sign_in_required", message: "Sign in first." }, { status: 401 });
  try {
    return await handler(sessionUser);
  } catch (error) {
    if (error instanceof DiscussionError) return NextResponse.json({ error: error.reason, message: error.message }, { status: STATUS[error.reason] });
    throw error;
  }
}

export async function json<T extends z.ZodType>(request: Request, schema: T) {
  return schema.safeParse(await request.json().catch(() => null));
}

export const invalid = (message = "Check what you entered.") => NextResponse.json({ error: "invalid", message }, { status: 400 });
