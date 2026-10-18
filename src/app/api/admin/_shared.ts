import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminUser, type SessionUser } from "@/lib/auth";
import { CourseError } from "@/lib/courses/admin";
import { CollectionError } from "@/lib/collections/service";
import { CommentError } from "@/lib/comments/service";
import { ApplicationError } from "@/lib/creators/applications";
import { ResourceError } from "@/lib/courses/resources";
import { QuizDraftError } from "@/lib/learning/quiz-drafter";
import { QuizError } from "@/lib/learning/quizzes";
import { ModerationError } from "@/lib/moderation/service";
import { PayoutError } from "@/lib/payouts/service";
import { SettlementError } from "@/lib/revenue/settlement";
import { RatingError } from "@/lib/ratings/service";
import { ThemeServiceError } from "@/lib/themes/service";

export const targetSchema = z.object({ kind: z.enum(["video", "course"]), id: z.uuid() });

const MODERATION_STATUS: Record<ModerationError["reason"], number> = {
  not_found: 404,
  invalid_transition: 409,
  notes_required: 400,
  not_reportable: 400,
};

const QUIZ_STATUS: Record<QuizError["reason"], number> = { not_found: 404, invalid: 400, not_allowed: 409, not_publishable: 409 };

/** Run an admin-only handler: 403 for everyone else; service errors become 4xx with their message. */
export async function asAdmin(handler: (admin: SessionUser) => Promise<Response>): Promise<Response> {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  try {
    return await handler(admin);
  } catch (error) {
    if (error instanceof ThemeServiceError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof CourseError) {
      return NextResponse.json({ error: error.reason, message: error.message }, { status: error.reason === "not_found" ? 404 : 400 });
    }
    if (error instanceof ApplicationError) {
      return NextResponse.json({ error: error.reason, message: error.message }, { status: error.reason === "not_found" || error.reason === "no_account" ? 404 : 409 });
    }
    if (error instanceof CollectionError || error instanceof CommentError) {
      return NextResponse.json({ error: error.reason, message: error.message }, { status: error.reason === "not_found" ? 404 : 400 });
    }
    if (error instanceof ResourceError) {
      return NextResponse.json({ error: error.reason, message: error.message }, { status: error.reason === "not_found" ? 404 : 400 });
    }
    if (error instanceof RatingError) {
      return NextResponse.json({ error: error.reason, message: error.message }, { status: error.reason === "not_found" ? 404 : 400 });
    }
    if (error instanceof QuizError) {
      return NextResponse.json({ error: error.reason, message: error.message }, { status: QUIZ_STATUS[error.reason] });
    }
    if (error instanceof QuizDraftError) return NextResponse.json({ error: "draft_failed", message: error.message }, { status: 502 });
    if (error instanceof PayoutError) {
      return NextResponse.json({ error: error.reason, message: error.message }, { status: error.reason === "not_found" ? 404 : 409 });
    }
    if (error instanceof SettlementError) return NextResponse.json({ error: "settlement", message: error.message }, { status: 409 });
    if (error instanceof ModerationError) {
      return NextResponse.json({ error: error.reason, message: error.message }, { status: MODERATION_STATUS[error.reason] });
    }
    throw error;
  }
}

export async function readJson<T extends z.ZodType>(request: Request, schema: T) {
  return schema.safeParse(await request.json().catch(() => null));
}
