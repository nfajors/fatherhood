import { after, NextResponse } from "next/server";
import { z } from "zod";
import { deleteResource, moveResource, RESOURCE_KINDS, updateResource } from "@/lib/courses/resources";
import { getDb } from "@/lib/db";
import { r2FromEnv } from "@/lib/storage/r2";
import { asAdmin, readJson } from "../../../_shared";

const body = z.union([
  z.object({ move: z.enum(["up", "down"]) }),
  z.object({ title: z.string().trim().min(2).max(140).optional(), kind: z.enum(RESOURCE_KINDS).optional() }),
]);

/** Rename, re-kind or reorder a lesson file. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return asAdmin(async () => {
    const { id } = await params;
    const parsed = await readJson(request, body);
    if (!z.uuid().safeParse(id).success || !parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    const db = getDb();
    if ("move" in parsed.data) return NextResponse.json({ moved: await moveResource(db, id, parsed.data.move) });
    await updateResource(db, id, parsed.data);
    return NextResponse.json({ updated: true });
  });
}

/** Remove a lesson file, and delete it from R2. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return asAdmin(async () => {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    const { key } = await deleteResource(getDb(), id);
    after(async () => {
      try {
        await (await r2FromEnv()).delete(key);
      } catch (error) {
        console.error(`R2 object ${key}: delete failed`, error);
      }
    });
    return NextResponse.json({ deleted: true });
  });
}
