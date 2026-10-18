import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { commentErrorResponse } from "@/lib/comments/http";
import { reportComment } from "@/lib/comments/service";
import { getDb } from "@/lib/db";
import { REPORT_REASONS, type ReportReason } from "@/lib/moderation/policy";

const body = z.object({ reason: z.enum(Object.keys(REPORT_REASONS) as [ReportReason, ...ReportReason[]]) });

/** Report a comment to the moderators. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return NextResponse.json({ error: "sign_in_required", message: "Sign in to report a comment." }, { status: 401 });
  const { id } = await params;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!z.uuid().safeParse(id).success || !parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  try {
    const result = await reportComment(getDb(), { commentId: id, reporterId: sessionUser.id, reason: parsed.data.reason });
    // Whether the report hid the comment is for moderators, not reporters.
    return NextResponse.json({ received: true, alreadyReported: result.alreadyReported });
  } catch (error) {
    return commentErrorResponse(error);
  }
}
