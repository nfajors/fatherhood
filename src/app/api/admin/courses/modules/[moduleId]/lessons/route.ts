import { NextResponse } from "next/server";
import { z } from "zod";
import { addLesson } from "@/lib/courses/admin";
import { lessonFields } from "@/lib/courses/fields";
import { getDb } from "@/lib/db";
import { asAdmin, readJson } from "../../../../_shared";

export async function POST(request: Request, { params }: { params: Promise<{ moduleId: string }> }) {
  return asAdmin(async () => {
    const { moduleId } = await params;
    const parsed = await readJson(request, lessonFields);
    if (!z.uuid().safeParse(moduleId).success || !parsed.success) return NextResponse.json({ error: "invalid_request", message: "Give the lesson a title." }, { status: 400 });
    return NextResponse.json({ lesson: await addLesson(getDb(), moduleId, parsed.data) }, { status: 201 });
  });
}
