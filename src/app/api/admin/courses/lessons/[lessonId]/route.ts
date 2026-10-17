import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteLesson, moveLesson, updateLesson } from "@/lib/courses/admin";
import { lessonFields } from "@/lib/courses/fields";
import { getDb } from "@/lib/db";
import { asAdmin, readJson } from "../../../_shared";

type Params = { params: Promise<{ lessonId: string }> };

/** Edit a lesson, or reorder it ({move: "up" | "down"}). */
export async function PATCH(request: Request, { params }: Params) {
  return asAdmin(async () => {
    const { lessonId } = await params;
    const parsed = await readJson(request, z.union([z.object({ move: z.enum(["up", "down"]) }), lessonFields.partial()]));
    if (!z.uuid().safeParse(lessonId).success || !parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    const db = getDb();
    if ("move" in parsed.data) return NextResponse.json({ moved: await moveLesson(db, lessonId, parsed.data.move as "up" | "down") });
    return NextResponse.json({ lesson: await updateLesson(db, lessonId, parsed.data) });
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  return asAdmin(async () => {
    const { lessonId } = await params;
    if (!z.uuid().safeParse(lessonId).success) return NextResponse.json({ error: "not_found" }, { status: 404 });
    await deleteLesson(getDb(), lessonId);
    return NextResponse.json({ ok: true });
  });
}
