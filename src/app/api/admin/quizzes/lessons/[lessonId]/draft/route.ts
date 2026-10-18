import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { draftQuizForLesson, getQuizDrafter } from "@/lib/learning/quiz-drafter";
import { asAdmin } from "../../../../_shared";

/** Ask the AI for draft questions from the lesson's summary and transcript. */
export async function POST(_request: Request, { params }: { params: Promise<{ lessonId: string }> }) {
  return asAdmin(async () => {
    const drafter = getQuizDrafter();
    if (!drafter) return NextResponse.json({ error: "drafter_not_configured", message: "AI drafting needs ANTHROPIC_API_KEY." }, { status: 503 });
    const { lessonId } = await params;
    if (!z.uuid().safeParse(lessonId).success) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const { added } = await draftQuizForLesson(getDb(), drafter, lessonId);
    return NextResponse.json({ added: added.length });
  });
}
