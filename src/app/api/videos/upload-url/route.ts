import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { CATEGORIES, COMMUNITY_MAX_DURATION_SECONDS, PROFESSIONAL_MAX_DURATION_SECONDS } from "@/lib/config";
import { getDb } from "@/lib/db";
import { videos } from "@/lib/db/schema";
import { canUpload } from "@/lib/entitlements";
import { streamFromEnv } from "@/lib/stream";

const body = z.object({
  type: z.enum(["professional", "community"]),
  title: z.string().trim().min(3).max(140),
  description: z.string().trim().max(5000).optional(),
  category: z.enum(CATEGORIES).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
});

/**
 * Create a video record and a one-time Cloudflare Stream upload URL. The
 * browser uploads straight to Cloudflare; the Stream webhook takes it from there.
 */
export async function POST(request: Request) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return NextResponse.json({ error: "sign_in_required" }, { status: 401 });

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
  const input = parsed.data;

  if (!canUpload(sessionUser.role, input.type)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { env, client } = await streamFromEnv();
  const requireSignedUrls = input.type === "professional";
  const upload = await client.createDirectUpload({
    maxDurationSeconds: input.type === "community" ? COMMUNITY_MAX_DURATION_SECONDS : PROFESSIONAL_MAX_DURATION_SECONDS,
    creatorId: sessionUser.id,
    requireSignedURLs: requireSignedUrls,
    watermarkUid: env.CLOUDFLARE_STREAM_WATERMARK_UID,
    meta: { name: input.title, type: input.type },
  });

  const [video] = await getDb()
    .insert(videos)
    .values({
      type: input.type,
      status: "uploading",
      creatorId: sessionUser.id,
      title: input.title,
      description: input.description,
      category: input.category,
      tags: input.tags ?? [],
      cloudflareUid: upload.uid,
      requireSignedUrls,
      watermarkApplied: Boolean(env.CLOUDFLARE_STREAM_WATERMARK_UID),
    })
    .returning({ id: videos.id });

  return NextResponse.json({ videoId: video?.id, uploadUrl: upload.uploadURL }, { status: 201 });
}
