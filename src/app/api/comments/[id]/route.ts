import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { commentErrorResponse } from "@/lib/comments/http";
import { COMMENT_POLICY, deleteOwnComment, editComment } from "@/lib/comments/service";
import { getDb } from "@/lib/db";

/** Edit your own comment. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return NextResponse.json({ error: "sign_in_required" }, { status: 401 });
  const { id } = await params;
  const parsed = z.object({ body: z.string().max(COMMENT_POLICY.maxChars * 2) }).safeParse(await request.json().catch(() => null));
  if (!z.uuid().safeParse(id).success || !parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  try {
    await editComment(getDb(), sessionUser.id, id, parsed.data.body);
    return NextResponse.json({ updated: true });
  } catch (error) {
    return commentErrorResponse(error);
  }
}

/** Delete your own comment. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return NextResponse.json({ error: "sign_in_required" }, { status: 401 });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  try {
    await deleteOwnComment(getDb(), sessionUser.id, id);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return commentErrorResponse(error);
  }
}
