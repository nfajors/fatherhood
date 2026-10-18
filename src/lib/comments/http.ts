import { NextResponse } from "next/server";
import { CommentError } from "./service";

const STATUS: Record<CommentError["reason"], number> = { not_found: 404, not_allowed: 403, invalid: 400, rate_limited: 429, not_yours: 403 };

/** Comment errors as JSON responses with their message. */
export function commentErrorResponse(error: unknown): Response {
  if (error instanceof CommentError) return NextResponse.json({ error: error.reason, message: error.message }, { status: STATUS[error.reason] });
  throw error;
}
