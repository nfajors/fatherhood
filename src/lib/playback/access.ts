/**
 * Who may play a video, and the Stream source to play it from. Shared by the
 * playback API and the server-rendered player pages.
 */
import { and, eq } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth";
import { SIGNED_PLAYBACK_TTL_SECONDS } from "@/lib/config";
import type { Database } from "@/lib/db";
import { courseModules, courses, lessons, subscriptions, videos } from "@/lib/db/schema";
import { canWatch, hasActiveMembership, type AccessDecision, type Viewer } from "@/lib/entitlements";
import { signPlaybackToken, streamFromEnv } from "@/lib/stream";

type Video = typeof videos.$inferSelect;

export async function loadViewer(db: Database, sessionUser: SessionUser | null): Promise<Viewer> {
  if (!sessionUser) return null;
  return {
    id: sessionUser.id,
    role: sessionUser.role,
    memberships: await db
      .select({ status: subscriptions.status, currentPeriodEnd: subscriptions.currentPeriodEnd })
      .from(subscriptions)
      .where(eq(subscriptions.userId, sessionUser.id)),
  };
}

export function isMember(viewer: Viewer): boolean {
  return viewer !== null && (viewer.role === "admin" || hasActiveMembership(viewer.memberships));
}

/** True when this video is a free preview lesson in a published course. */
export async function isPreviewVideo(db: Database, videoId: string): Promise<boolean> {
  const [preview] = await db
    .select({ id: lessons.id })
    .from(lessons)
    .innerJoin(courseModules, eq(lessons.moduleId, courseModules.id))
    .innerJoin(courses, eq(courseModules.courseId, courses.id))
    .where(and(eq(lessons.videoId, videoId), eq(lessons.isPreview, true), eq(courses.published, true)))
    .limit(1);
  return Boolean(preview);
}

export type PlaybackSource = {
  /** A Stream video uid, or a signed token that stands in for it. */
  src: string;
  customerCode: string;
  expiresAt: Date | null;
};

export async function accessFor(db: Database, video: Video, viewer: Viewer): Promise<AccessDecision> {
  return canWatch(video, viewer, { isPreviewLesson: await isPreviewVideo(db, video.id) });
}

/** The Stream source for an allowed decision; null when Stream isn't configured. */
export async function playbackSource(video: Video, decision: Extract<AccessDecision, { allowed: true }>): Promise<PlaybackSource | null> {
  if (!video.cloudflareUid) return null;
  let stream;
  try {
    stream = await streamFromEnv();
  } catch {
    return null;
  }
  const customerCode = stream.env.CLOUDFLARE_STREAM_CUSTOMER_CODE;
  if (!decision.signed) return { src: video.cloudflareUid, customerCode, expiresAt: null };
  const src = await signPlaybackToken({
    videoUid: video.cloudflareUid,
    keyId: stream.env.CLOUDFLARE_STREAM_SIGNING_KEY_ID,
    jwkBase64: stream.env.CLOUDFLARE_STREAM_SIGNING_KEY_JWK,
    ttlSeconds: SIGNED_PLAYBACK_TTL_SECONDS,
  });
  return { src, customerCode, expiresAt: new Date(Date.now() + SIGNED_PLAYBACK_TTL_SECONDS * 1000) };
}
