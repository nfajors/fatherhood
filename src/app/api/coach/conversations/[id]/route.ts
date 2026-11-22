import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteConversation } from "@/lib/coach/conversations";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

/** Delete one of the member's own conversations (works even after membership ends). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return NextResponse.json({ error: "sign_in_required" }, { status: 401 });
  const id = z.uuid().safeParse((await params).id);
  if (!id.success || !(await deleteConversation(getDb(), sessionUser.id, id.data))) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
