import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { updateQuiz } from "@/lib/learning/quizzes";
import { asAdmin, readJson } from "../../_shared";

const body = z.object({ passPercent: z.number().int().optional(), published: z.boolean().optional() });

/** Change the pass mark or publish/unpublish. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return asAdmin(async () => {
    const { id } = await params;
    const parsed = await readJson(request, body);
    if (!z.uuid().safeParse(id).success || !parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    return NextResponse.json({ quiz: await updateQuiz(getDb(), id, parsed.data) });
  });
}
