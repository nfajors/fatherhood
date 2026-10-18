import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { addQuestions } from "@/lib/learning/quizzes";
import { asAdmin, readJson } from "../../../_shared";
import { questionFields } from "../../_shared";

/** Add a question to the end of the quiz. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return asAdmin(async () => {
    const { id } = await params;
    const parsed = await readJson(request, questionFields);
    if (!z.uuid().safeParse(id).success || !parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    const [question] = await addQuestions(getDb(), id, [parsed.data]);
    return NextResponse.json({ question }, { status: 201 });
  });
}
