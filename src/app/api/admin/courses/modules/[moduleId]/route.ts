import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteModule, moveModule, renameModule } from "@/lib/courses/admin";
import { getDb } from "@/lib/db";
import { asAdmin, readJson } from "../../../_shared";

type Params = { params: Promise<{ moduleId: string }> };

/** Rename ({title}) or reorder ({move: "up" | "down"}). */
export async function PATCH(request: Request, { params }: Params) {
  return asAdmin(async () => {
    const { moduleId } = await params;
    const parsed = await readJson(request, z.union([z.object({ title: z.string().trim().min(1).max(140) }), z.object({ move: z.enum(["up", "down"]) })]));
    if (!z.uuid().safeParse(moduleId).success || !parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    const db = getDb();
    if ("move" in parsed.data) return NextResponse.json({ moved: await moveModule(db, moduleId, parsed.data.move) });
    return NextResponse.json({ module: await renameModule(db, moduleId, parsed.data.title) });
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  return asAdmin(async () => {
    const { moduleId } = await params;
    if (!z.uuid().safeParse(moduleId).success) return NextResponse.json({ error: "not_found" }, { status: 404 });
    await deleteModule(getDb(), moduleId);
    return NextResponse.json({ ok: true });
  });
}
