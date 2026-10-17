import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { REPORT_REASONS, type ReportReason } from "@/lib/moderation/policy";
import { ModerationError, reportVideo } from "@/lib/moderation/service";

const body = z.object({
  reason: z.enum(Object.keys(REPORT_REASONS) as [ReportReason, ...ReportReason[]]),
  details: z.string().trim().max(1000).optional(),
});

/** A signed-in viewer reports a published video. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return NextResponse.json({ error: "sign_in_required" }, { status: 401 });
  const { id } = await params;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!z.uuid().safeParse(id).success || !parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  try {
    const result = await reportVideo(getDb(), { videoId: id, reporterId: sessionUser.id, reason: parsed.data.reason, details: parsed.data.details });
    // Whether the report hid the video is for moderators, not reporters.
    return NextResponse.json({ received: true, alreadyReported: result.alreadyReported }, { status: result.alreadyReported ? 200 : 201 });
  } catch (error) {
    if (error instanceof ModerationError) return NextResponse.json({ error: error.reason, message: error.message }, { status: 400 });
    throw error;
  }
}
