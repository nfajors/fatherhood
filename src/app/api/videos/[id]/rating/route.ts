import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { RATING_POLICY } from "@/lib/ratings/policy";
import { rate, RatingError, removeRating } from "@/lib/ratings/service";

const body = z.object({
  stars: z.number().int().min(1).max(5),
  review: z.string().trim().max(RATING_POLICY.maxReviewChars, `Reviews can be up to ${RATING_POLICY.maxReviewChars} characters.`).nullable().optional(),
});

function failure(error: unknown) {
  if (error instanceof RatingError) {
    return NextResponse.json({ error: error.reason, message: error.message }, { status: error.reason === "not_found" ? 404 : 403 });
  }
  throw error;
}

/** Rate a video (or change your rating), with an optional written review. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return NextResponse.json({ error: "sign_in_required" }, { status: 401 });
  const { id } = await params;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!z.uuid().safeParse(id).success || !parsed.success) {
    return NextResponse.json({ error: "invalid_request", message: parsed.error?.issues[0]?.message ?? "Choose 1 to 5 stars." }, { status: 400 });
  }
  try {
    const rating = await rate(getDb(), { videoId: id, userId: sessionUser.id, stars: parsed.data.stars, review: parsed.data.review });
    return NextResponse.json({ rating: { stars: rating.stars, review: rating.review } });
  } catch (error) {
    return failure(error);
  }
}

/** Remove your rating and review. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return NextResponse.json({ error: "sign_in_required" }, { status: 401 });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  await removeRating(getDb(), id, sessionUser.id);
  return NextResponse.json({ removed: true });
}
