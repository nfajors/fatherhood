import { after, NextResponse } from "next/server";
import { z } from "zod";
import { CATEGORIES } from "@/lib/config";
import { deleteFromStream } from "@/lib/creators/runtime";
import { deleteVideo, updateDetails } from "@/lib/creators/videos";
import { getDb } from "@/lib/db";
import { asCreator, videoDetails, videoId } from "../../_shared";

const body = videoDetails.extend({ category: z.enum(CATEGORIES).nullable() }).partial();

/** Edit a video's details (until it is published). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return asCreator(async (creator) => {
    const { id } = await params;
    const parsed = body.safeParse(await request.json().catch(() => null));
    if (!videoId.safeParse(id).success || !parsed.success) {
      return NextResponse.json({ error: "invalid_request", message: parsed.error?.issues[0]?.message }, { status: 400 });
    }
    const video = await updateDetails(getDb(), creator.id, id, parsed.data);
    return NextResponse.json({ video: { id: video.id, status: video.status } });
  });
}

/** Delete an unpublished video, and its file from Stream. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return asCreator(async (creator) => {
    const { id } = await params;
    if (!videoId.safeParse(id).success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    const { cloudflareUid } = await deleteVideo(getDb(), creator.id, id);
    if (cloudflareUid) after(() => deleteFromStream(cloudflareUid));
    return NextResponse.json({ deleted: true });
  });
}
