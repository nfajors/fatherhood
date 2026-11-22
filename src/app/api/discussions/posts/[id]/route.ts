import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { getPostScreener } from "@/lib/discussions/screen";
import { deleteOwnPost, editPost } from "@/lib/discussions/service";
import { asSignedIn, invalid, json, uuid } from "../../_shared";

const body = z.object({ body: z.string().max(10_000) });

/** Edit your own post (it's checked again). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = uuid.safeParse((await params).id);
  return asSignedIn(async (user) => {
    const parsed = await json(request, body);
    if (!id.success || !parsed.success) return invalid();
    const result = await editPost(getDb(), getPostScreener(), user.id, id.data, parsed.data.body);
    return NextResponse.json(result);
  });
}

/** Delete your own post. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = uuid.safeParse((await params).id);
  return asSignedIn(async (user) => {
    if (!id.success) return invalid();
    await deleteOwnPost(getDb(), user.id, id.data);
    return NextResponse.json({ deleted: true });
  });
}
