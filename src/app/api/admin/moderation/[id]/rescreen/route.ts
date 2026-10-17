import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { getMailer } from "@/lib/email";
import { getScreener, streamMedia } from "@/lib/moderation/runtime";
import { screenVideo } from "@/lib/moderation/service";
import { asAdmin } from "../../../_shared";

/** Run the AI screen again now, with whatever transcript is available. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return asAdmin(async () => {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const screener = getScreener();
    if (!screener) return NextResponse.json({ error: "screener_not_configured" }, { status: 503 });
    const outcome = await screenVideo(getDb(), id, { media: streamMedia, screener, mailer: getMailer() }, { force: true });
    return NextResponse.json(outcome);
  });
}
