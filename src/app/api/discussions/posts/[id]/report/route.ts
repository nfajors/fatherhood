import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { reportPost } from "@/lib/discussions/service";
import { REPORT_REASONS, type ReportReason } from "@/lib/moderation/policy";
import { asSignedIn, invalid, json, uuid } from "../../../_shared";

const body = z.object({ reason: z.enum(Object.keys(REPORT_REASONS) as [ReportReason, ...ReportReason[]]) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = uuid.safeParse((await params).id);
  return asSignedIn(async (user) => {
    const parsed = await json(request, body);
    if (!id.success || !parsed.success) return invalid("Choose a reason.");
    return NextResponse.json(await reportPost(getDb(), { postId: id.data, reporterId: user.id, reason: parsed.data.reason }));
  });
}
