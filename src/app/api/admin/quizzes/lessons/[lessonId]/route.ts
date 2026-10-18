import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { adminQuiz, getOrCreateQuiz } from "@/lib/learning/quizzes";
import { asAdmin } from "../../../_shared";

type Params = { params: Promise<{ lessonId: string }> };

/** A lesson's quiz with answers, or {quiz: null} when it has none yet. */
export async function GET(_request: Request, { params }: Params) {
  return asAdmin(async () => {
    const { lessonId } = await params;
    if (!z.uuid().safeParse(lessonId).success) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const found = await adminQuiz(getDb(), lessonId);
    return NextResponse.json(found ?? { quiz: null, questions: [] });
  });
}

/** Create the lesson's quiz (idempotent). */
export async function POST(_request: Request, { params }: Params) {
  return asAdmin(async () => {
    const { lessonId } = await params;
    if (!z.uuid().safeParse(lessonId).success) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ quiz: await getOrCreateQuiz(getDb(), lessonId) });
  });
}
