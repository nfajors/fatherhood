import { after, NextResponse } from "next/server";
import { z } from "zod";
import { resubmit } from "@/lib/creators/videos";
import { getDb } from "@/lib/db";
import { startScreening } from "@/lib/moderation/runtime";
import { themeInBackground } from "@/lib/themes/runtime";
import { asCreator, videoId } from "../../../_shared";

const body = z.object({ note: z.string().trim().max(1000).nullable().optional() });

/** Send a video back for review after a change request. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return asCreator(async (creator) => {
    const { id } = await params;
    const parsed = body.safeParse(await request.json().catch(() => ({})));
    if (!videoId.safeParse(id).success || !parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    const video = await resubmit(getDb(), creator.id, id, parsed.data.note ?? null);
    // Back in the queue: re-theme (details may have changed) and re-screen.
    after(async () => {
      await themeInBackground({ kind: "video", id: video.id });
      await startScreening(video.id);
    });
    return NextResponse.json({ video: { id: video.id, status: video.status } });
  });
}
