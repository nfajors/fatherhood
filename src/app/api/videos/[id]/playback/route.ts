import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { SIGNED_PLAYBACK_TTL_SECONDS } from "@/lib/config";
import { getDb } from "@/lib/db";
import { lessons, subscriptions, videos } from "@/lib/db/schema";
import { canWatch, type Viewer } from "@/lib/entitlements";
import { signPlaybackToken, streamFromEnv } from "@/lib/stream";

const ERROR_STATUS = { not_published: 404, sign_in_required: 401, membership_required: 403 } as const;

/** Check entitlement and return playback URLs (signed for Professional content). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const db = getDb();
  const video = await db.query.videos.findFirst({ where: eq(videos.id, id) });
  if (!video?.cloudflareUid) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const sessionUser = await getSessionUser();
  const viewer: Viewer = sessionUser
    ? {
        id: sessionUser.id,
        role: sessionUser.role,
        memberships: await db
          .select({ status: subscriptions.status, currentPeriodEnd: subscriptions.currentPeriodEnd })
          .from(subscriptions)
          .where(eq(subscriptions.userId, sessionUser.id)),
      }
    : null;
  const preview = await db.query.lessons.findFirst({
    where: and(eq(lessons.videoId, video.id), eq(lessons.isPreview, true)),
    columns: { id: true },
  });

  const decision = canWatch(video, viewer, { isPreviewLesson: Boolean(preview) });
  if (!decision.allowed) return NextResponse.json({ error: decision.reason }, { status: ERROR_STATUS[decision.reason] });

  const { env, client } = await streamFromEnv();
  if (!decision.signed) return NextResponse.json({ urls: client.playbackUrls(video.cloudflareUid), expiresAt: null });

  const token = await signPlaybackToken({
    videoUid: video.cloudflareUid,
    keyId: env.CLOUDFLARE_STREAM_SIGNING_KEY_ID,
    jwkBase64: env.CLOUDFLARE_STREAM_SIGNING_KEY_JWK,
    ttlSeconds: SIGNED_PLAYBACK_TTL_SECONDS,
  });
  return NextResponse.json(
    {
      urls: client.playbackUrls(token),
      expiresAt: new Date(Date.now() + SIGNED_PLAYBACK_TTL_SECONDS * 1000).toISOString(),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
