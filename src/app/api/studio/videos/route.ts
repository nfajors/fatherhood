import { NextResponse } from "next/server";
import { z } from "zod";
import { CATEGORIES } from "@/lib/config";
import { createDraft } from "@/lib/creators/videos";
import { getDb } from "@/lib/db";
import { asCreator, videoDetails } from "../_shared";

const body = videoDetails.partial({ description: true, category: true, tags: true }).extend({
  type: z.enum(["community", "professional"]).default("community"),
  category: z.enum(CATEGORIES).nullable().optional(),
});

/** Create the video record; its file is uploaded next (see ./[id]/upload). */
export async function POST(request: Request) {
  return asCreator(async (creator) => {
    const parsed = body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "invalid_request", message: parsed.error.issues[0]?.message }, { status: 400 });
    const video = await createDraft(getDb(), creator, parsed.data);
    return NextResponse.json({ video: { id: video.id } }, { status: 201 });
  });
}
