import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { RatingError, setHelpful } from "@/lib/ratings/service";

/** Mark a review helpful, or take the vote back. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return NextResponse.json({ error: "sign_in_required", message: "Sign in to vote." }, { status: 401 });
  const { id } = await params;
  const parsed = z.object({ helpful: z.boolean() }).safeParse(await request.json().catch(() => null));
  if (!z.uuid().safeParse(id).success || !parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  try {
    return NextResponse.json(await setHelpful(getDb(), id, sessionUser.id, parsed.data.helpful));
  } catch (error) {
    if (error instanceof RatingError) {
      return NextResponse.json({ error: error.reason, message: error.message }, { status: error.reason === "not_found" ? 404 : 403 });
    }
    throw error;
  }
}
