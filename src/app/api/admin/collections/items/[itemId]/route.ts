import { NextResponse } from "next/server";
import { z } from "zod";
import { moveItem, removeItem, updateItemNote } from "@/lib/collections/service";
import { getDb } from "@/lib/db";
import { asAdmin, readJson } from "../../../_shared";

const body = z.union([z.object({ move: z.enum(["up", "down"]) }), z.object({ note: z.string().trim().max(500).nullable() })]);

/** Reorder an item or change its note. */
export async function PATCH(request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  return asAdmin(async () => {
    const { itemId } = await params;
    const parsed = await readJson(request, body);
    if (!z.uuid().safeParse(itemId).success || !parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    const db = getDb();
    if ("move" in parsed.data) return NextResponse.json({ moved: await moveItem(db, itemId, parsed.data.move) });
    await updateItemNote(db, itemId, parsed.data.note);
    return NextResponse.json({ updated: true });
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  return asAdmin(async () => {
    const { itemId } = await params;
    if (!z.uuid().safeParse(itemId).success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    await removeItem(getDb(), itemId);
    return NextResponse.json({ removed: true });
  });
}
