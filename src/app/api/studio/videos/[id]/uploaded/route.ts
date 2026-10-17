import { NextResponse } from "next/server";
import { markUploaded } from "@/lib/creators/videos";
import { getDb } from "@/lib/db";
import { streamFromEnv } from "@/lib/stream";
import { asCreator, videoId } from "../../../_shared";

/** The browser finished uploading: show the video as processing once Stream confirms the file arrived. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return asCreator(async (creator) => {
    const { id } = await params;
    if (!videoId.safeParse(id).success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    const { client } = await streamFromEnv();
    const video = await markUploaded(getDb(), client, creator.id, id);
    return NextResponse.json({ video: { id: video.id, status: video.status } });
  });
}
