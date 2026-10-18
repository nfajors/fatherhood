import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { deleteQuestion, moveQuestion, updateQuestion } from "@/lib/learning/quizzes";
import { asAdmin, readJson } from "../../../_shared";
import { questionFields } from "../../_shared";

type Params = { params: Promise<{ questionId: string }> };

/** Edit a question, or reorder it ({move: "up" | "down"}). */
export async function PATCH(request: Request, { params }: Params) {
  return asAdmin(async () => {
    const { questionId } = await params;
    const parsed = await readJson(request, z.union([z.object({ move: z.enum(["up", "down"]) }), questionFields]));
    if (!z.uuid().safeParse(questionId).success || !parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    const db = getDb();
    if ("move" in parsed.data) return NextResponse.json({ moved: await moveQuestion(db, questionId, parsed.data.move) });
    return NextResponse.json({ question: await updateQuestion(db, questionId, parsed.data) });
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  return asAdmin(async () => {
    const { questionId } = await params;
    if (!z.uuid().safeParse(questionId).success) return NextResponse.json({ error: "not_found" }, { status: 404 });
    await deleteQuestion(getDb(), questionId);
    return NextResponse.json({ ok: true });
  });
}
