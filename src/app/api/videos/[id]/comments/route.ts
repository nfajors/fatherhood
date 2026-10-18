import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { commentErrorResponse } from "@/lib/comments/http";
import { COMMENT_POLICY, postComment } from "@/lib/comments/service";
import { getDb } from "@/lib/db";

const body = z.object({ body: z.string().max(COMMENT_POLICY.maxChars * 2), parentId: z.uuid().nullable().optional() });

/** Post a comment or a reply. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return NextResponse.json({ error: "sign_in_required", message: "Sign in to comment." }, { status: 401 });
  const { id } = await params;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!z.uuid().safeParse(id).success || !parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  try {
    const comment = await postComment(getDb(), sessionUser, { videoId: id, body: parsed.data.body, parentId: parsed.data.parentId });
    return NextResponse.json({ comment: { id: comment.id } }, { status: 201 });
  } catch (error) {
    return commentErrorResponse(error);
  }
}
