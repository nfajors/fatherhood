import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { getMailer } from "@/lib/email";
import { bulkApprove } from "@/lib/moderation/service";
import { asAdmin, readJson } from "../../_shared";

/** Approve several queued videos at once (the "approve all recommended" button). */
export async function POST(request: Request) {
  return asAdmin(async (admin) => {
    const parsed = await readJson(request, z.object({ videoIds: z.array(z.uuid()).min(1).max(50) }));
    if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    return NextResponse.json(await bulkApprove(getDb(), parsed.data.videoIds, admin.id, getMailer()));
  });
}
