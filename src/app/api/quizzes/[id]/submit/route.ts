import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { issueForVideo, type Certificate } from "@/lib/learning/certificates";
import { QUIZ_POLICY, QuizError, submitQuiz } from "@/lib/learning/quizzes";

const body = z.object({
  answers: z.record(z.uuid(), z.array(z.string().max(32)).max(QUIZ_POLICY.maxOptions)),
});

const STATUS: Record<QuizError["reason"], number> = { not_found: 404, invalid: 400, not_allowed: 403, not_publishable: 409 };

/**
 * Grade an attempt. The response carries the correct answers and explanations,
 * and any certificate the pass just earned (checked inline so the learner hears
 * about it straight away).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return NextResponse.json({ error: "sign_in_required" }, { status: 401 });
  const { id } = await params;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!z.uuid().safeParse(id).success || !parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  try {
    const db = getDb();
    const { videoId, ...result } = await submitQuiz(db, sessionUser, id, parsed.data.answers);
    let certificates: Pick<Certificate, "code" | "courseTitle">[] = [];
    if (result.passed) {
      certificates = await issueForVideo(db, sessionUser.id, videoId).catch((error) => {
        console.error(`Certificate check failed after quiz ${id}:`, error);
        return [];
      });
    }
    return NextResponse.json({ ...result, certificates: certificates.map((c) => ({ code: c.code, courseTitle: c.courseTitle })) });
  } catch (error) {
    if (error instanceof QuizError) return NextResponse.json({ error: error.reason, message: error.message }, { status: STATUS[error.reason] });
    throw error;
  }
}
