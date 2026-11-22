import { NextResponse } from "next/server";
import { getSessionUser, type SessionUser } from "@/lib/auth";
import { canUseCoach, coachConfigured } from "@/lib/coach/access";
import { CoachError } from "@/lib/coach/conversations";
import { PathError } from "@/lib/coach/path";
import { getDb } from "@/lib/db";

const STATUS: Record<CoachError["reason"], number> = { not_found: 404, invalid: 400, limit_reached: 429 };

/** Run a coach handler for a member; coach errors become 4xx with their message. */
export async function asCoachMember(handler: (member: SessionUser) => Promise<Response>): Promise<Response> {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return NextResponse.json({ error: "sign_in_required", message: "Sign in to talk with the coach." }, { status: 401 });
  if (!(await canUseCoach(getDb(), sessionUser))) {
    return NextResponse.json({ error: "membership_required", message: "The coach is part of membership." }, { status: 403 });
  }
  if (!coachConfigured()) return NextResponse.json({ error: "not_configured", message: "The coach isn't available right now." }, { status: 503 });
  try {
    return await handler(sessionUser);
  } catch (error) {
    if (error instanceof CoachError) return NextResponse.json({ error: error.reason, message: error.message }, { status: STATUS[error.reason] });
    if (error instanceof PathError) return NextResponse.json({ error: "path_failed", message: error.message }, { status: 502 });
    throw error;
  }
}
