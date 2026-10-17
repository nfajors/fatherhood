import { after, NextResponse } from "next/server";
import { deleteFromStream } from "@/lib/creators/runtime";
import { beginUpload } from "@/lib/creators/videos";
import { getDb } from "@/lib/db";
import { streamFromEnv } from "@/lib/stream";
import { asCreator, videoId } from "../../../_shared";

/**
 * tus "creation" endpoint for the browser's resumable upload (tus-js-client).
 * It starts the upload on Cloudflare with our settings and hands back
 * Cloudflare's upload URL in Location; the file itself never passes through
 * this server. Uploading again replaces the previous file.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return asCreator(async (creator) => {
    const { id } = await params;
    const uploadLength = Number(request.headers.get("upload-length"));
    if (!videoId.safeParse(id).success || !Number.isSafeInteger(uploadLength) || uploadLength <= 0) {
      return NextResponse.json({ error: "invalid_request", message: "Upload-Length is required." }, { status: 400 });
    }
    const { env, client } = await streamFromEnv();
    const { uploadURL, replacedUid } = await beginUpload(getDb(), client, {
      creatorId: creator.id,
      videoId: id,
      uploadLength,
      watermarkUid: env.CLOUDFLARE_STREAM_WATERMARK_UID,
    });
    if (replacedUid) after(() => deleteFromStream(replacedUid));
    return new Response(null, {
      status: 201,
      headers: { Location: uploadURL, "Tus-Resumable": "1.0.0", "Access-Control-Expose-Headers": "Location, Tus-Resumable" },
    });
  });
}
