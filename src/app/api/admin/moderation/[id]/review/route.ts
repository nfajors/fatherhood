import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { getMailer } from "@/lib/email";
import { applyReview } from "@/lib/moderation/service";
import { asAdmin, readJson } from "../../../_shared";

const body = z.object({
  action: z.enum(["approve", "request_changes", "reject", "unpublish", "restore"]),
  notes: z.string().trim().max(2000).optional(),
});

/** Record a reviewer's decision on a video and notify its creator. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return asAdmin(async (admin) => {
    const { id } = await params;
    const parsed = await readJson(request, body);
    if (!z.uuid().safeParse(id).success || !parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    const { video, emailed } = await applyReview(
      getDb(),
      { videoId: id, action: parsed.data.action, reviewerId: admin.id, notes: parsed.data.notes },
      getMailer(),
    );
    return NextResponse.json({ status: video.status, emailed });
  });
}
