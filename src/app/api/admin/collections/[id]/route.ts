import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteCollection, updateCollection } from "@/lib/collections/service";
import { getDb } from "@/lib/db";
import { asAdmin, readJson } from "../../_shared";

const body = z
  .object({
    title: z.string().trim().min(2).max(120),
    slug: z.string().trim().min(1).max(60),
    description: z.string().trim().max(2000).transform((v) => v || null).nullable(),
    published: z.boolean(),
    featured: z.boolean(),
    sortOrder: z.number().int().min(0).max(100_000),
  })
  .partial();

/** Edit, publish or feature a collection. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return asAdmin(async () => {
    const { id } = await params;
    const parsed = await readJson(request, body);
    if (!z.uuid().safeParse(id).success || !parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    return NextResponse.json({ collection: await updateCollection(getDb(), id, parsed.data) });
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return asAdmin(async () => {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    await deleteCollection(getDb(), id);
    return NextResponse.json({ deleted: true });
  });
}
