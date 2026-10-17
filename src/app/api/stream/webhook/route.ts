import { and, eq, inArray } from "drizzle-orm";
import { after, NextResponse } from "next/server";
import { COMMUNITY_MAX_DURATION_SECONDS } from "@/lib/config";
import { getDb } from "@/lib/db";
import { videoReviews, videos } from "@/lib/db/schema";
import { streamEnv } from "@/lib/env";
import { verifyStreamWebhook, type StreamVideo } from "@/lib/stream";
import { reviewDueAt } from "@/lib/moderation/decide";
import { startScreening } from "@/lib/moderation/runtime";
import { themeInBackground } from "@/lib/themes/runtime";

/**
 * Cloudflare Stream "video ready / errored" webhook. Moves a video from
 * uploading/processing into the review queue, or marks it failed.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const valid = verifyStreamWebhook({
    rawBody,
    signatureHeader: request.headers.get("webhook-signature"),
    secret: streamEnv().CLOUDFLARE_STREAM_WEBHOOK_SECRET,
  });
  if (!valid) return NextResponse.json({ error: "invalid_signature" }, { status: 401 });

  const payload = JSON.parse(rawBody) as StreamVideo;
  const db = getDb();
  const video = await db.query.videos.findFirst({
    where: and(eq(videos.cloudflareUid, payload.uid), inArray(videos.status, ["uploading", "processing"])),
  });
  if (!video) return NextResponse.json({ received: true }); // unknown or already handled

  const durationSeconds = payload.duration > 0 ? Math.round(payload.duration) : null;
  let toStatus: typeof video.status;
  let notes: string | null = null;

  if (payload.status.state === "error") {
    toStatus = "failed";
    notes = payload.status.errorReasonText ?? payload.status.errorReasonCode ?? "Encoding failed";
  } else if (payload.readyToStream) {
    // Cloudflare enforces maxDurationSeconds at upload; this is a backstop.
    if (video.type === "community" && durationSeconds !== null && durationSeconds > COMMUNITY_MAX_DURATION_SECONDS) {
      toStatus = "rejected";
      notes = "Community Voices videos must be 8 minutes or shorter.";
    } else {
      toStatus = "pending_review";
    }
  } else {
    toStatus = "processing";
  }

  await db.transaction(async (tx) => {
    await tx
      .update(videos)
      .set({
        status: toStatus,
        durationSeconds,
        thumbnailUrl: payload.thumbnail ?? null,
        reviewDueAt: toStatus === "pending_review" ? reviewDueAt(video.type, new Date()) : null,
      })
      .where(eq(videos.id, video.id));
    if (toStatus !== video.status && toStatus !== "processing") {
      await tx.insert(videoReviews).values({
        videoId: video.id,
        action: "ai_screen",
        fromStatus: video.status,
        toStatus,
        notes,
      });
    }
  });

  // Into the review queue: suggest themes for the reviewer and start the AI
  // screen (which first asks Stream for captions; the moderation cron finishes it).
  if (toStatus === "pending_review") {
    after(async () => {
      await themeInBackground({ kind: "video", id: video.id });
      await startScreening(video.id);
    });
  }

  return NextResponse.json({ received: true });
}
