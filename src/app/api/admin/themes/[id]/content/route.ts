import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { placeContent, removeContent } from "@/lib/themes/service";
import { asAdmin, readJson, targetSchema } from "../../_shared";

type Params = { params: Promise<{ id: string }> };

/** Place a video or course in this theme. */
export async function PUT(request: Request, { params }: Params) {
  return asAdmin(async () => {
    const { id } = await params;
    const parsed = await readJson(request, targetSchema.extend({ isPrimary: z.boolean().optional() }));
    if (!z.uuid().safeParse(id).success || !parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    const { isPrimary, ...target } = parsed.data;
    await placeContent(getDb(), id, target, isPrimary);
    return NextResponse.json({ ok: true });
  });
}

/** Remove a video or course from this theme; the AI will not place it here again. */
export async function DELETE(request: Request, { params }: Params) {
  return asAdmin(async () => {
    const { id } = await params;
    const parsed = await readJson(request, targetSchema);
    if (!z.uuid().safeParse(id).success || !parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    await removeContent(getDb(), id, parsed.data);
    return NextResponse.json({ ok: true });
  });
}
