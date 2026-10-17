/**
 * A creator's own videos: start an upload, edit details, resubmit after a
 * reviewer asks for changes, replace the file, delete. Reviewer decisions live
 * in lib/moderation; this is the creator's side of the same lifecycle.
 */
import { and, eq } from "drizzle-orm";
import { COMMUNITY_MAX_DURATION_SECONDS, MAX_UPLOAD_BYTES, PROFESSIONAL_MAX_DURATION_SECONDS } from "@/lib/config";
import type { Database } from "@/lib/db";
import { videoReviews, videos, type UserRole, type VideoStatus, type VideoType } from "@/lib/db/schema";
import { canUpload } from "@/lib/entitlements";
import { reviewDueAt } from "@/lib/moderation/decide";
import type { StreamClient } from "@/lib/stream";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type Video = typeof videos.$inferSelect;

export class StudioError extends Error {
  constructor(
    readonly reason: "not_found" | "forbidden" | "not_allowed_now" | "too_large",
    message: string,
  ) {
    super(message);
    this.name = "StudioError";
  }
}

/** What a creator may do to a video in each status. */
export const CREATOR_ACTIONS = {
  /** Change title, description, category and tags. Approved videos are locked: edits would skip review. */
  edit: ["uploading", "processing", "pending_review", "changes_requested", "failed"],
  /** Upload (or re-upload) the file: a first upload, a stalled one, a failed encode, or a requested change. */
  upload: ["uploading", "changes_requested", "failed"],
  /** Send back for review as is (after editing details). */
  resubmit: ["changes_requested"],
  /** Remove it entirely. Published and taken-down videos stay, for the record and the revenue history. */
  delete: ["uploading", "processing", "pending_review", "changes_requested", "rejected", "failed"],
} as const satisfies Record<string, readonly VideoStatus[]>;

export type CreatorAction = keyof typeof CREATOR_ACTIONS;

export function allows(action: CreatorAction, status: VideoStatus): boolean {
  return (CREATOR_ACTIONS[action] as readonly VideoStatus[]).includes(status);
}

export type VideoDetails = {
  title: string;
  description?: string | null;
  category?: string | null;
  tags?: string[];
};

/** Fields reset when a new file replaces the old one, so it is screened and reviewed afresh. */
const FRESH_FILE = {
  durationSeconds: null,
  thumbnailUrl: null,
  transcript: null,
  captionsRequestedAt: null,
  moderation: null,
  screenedAt: null,
  aiRisk: null,
  aiRecommendation: null,
  reviewDueAt: null,
} as const;

async function ownVideo(tx: Database | Transaction, creatorId: string, videoId: string, lock = false): Promise<Video> {
  const query = tx.select().from(videos).where(and(eq(videos.id, videoId), eq(videos.creatorId, creatorId)));
  const [video] = lock ? await query.for("update") : await query;
  if (!video) throw new StudioError("not_found", "Video not found.");
  return video;
}

function assertAllowed(action: CreatorAction, video: Video, message: string) {
  if (!allows(action, video.status)) throw new StudioError("not_allowed_now", message);
}

/** A new video record, before its file is uploaded. */
export async function createDraft(
  db: Database,
  creator: { id: string; role: UserRole },
  input: VideoDetails & { type: VideoType },
): Promise<Video> {
  if (!canUpload(creator.role, input.type)) {
    throw new StudioError("forbidden", input.type === "professional" ? "Only admins upload professional lessons." : "Uploading is for Fellows.");
  }
  const [video] = await db
    .insert(videos)
    .values({
      type: input.type,
      status: "uploading",
      creatorId: creator.id,
      title: input.title.trim(),
      description: input.description || null,
      category: input.category || null,
      tags: input.tags ?? [],
      requireSignedUrls: input.type === "professional",
    })
    .returning();
  return video!;
}

export async function updateDetails(db: Database, creatorId: string, videoId: string, details: Partial<VideoDetails>): Promise<Video> {
  return db.transaction(async (tx) => {
    const video = await ownVideo(tx, creatorId, videoId, true);
    assertAllowed("edit", video, "Published videos can't be edited. Write to us if something needs fixing.");
    const [updated] = await tx
      .update(videos)
      .set({ ...details, ...(details.title !== undefined ? { title: details.title.trim() } : {}) })
      .where(eq(videos.id, video.id))
      .returning();
    return updated!;
  });
}

export type UploadStarter = Pick<StreamClient, "createTusUpload">;

/**
 * Start a resumable upload for the video's file. Re-uploading (a stalled
 * upload, a failed encode, or a requested change) replaces the old file:
 * the video goes back to "uploading" and is screened and reviewed again.
 * Returns the replaced Stream uid, which the caller deletes from Stream.
 */
export async function beginUpload(
  db: Database,
  stream: UploadStarter,
  input: { creatorId: string; videoId: string; uploadLength: number; watermarkUid?: string },
  now: Date = new Date(),
): Promise<{ uploadURL: string; replacedUid: string | null }> {
  return db.transaction(async (tx) => {
    const video = await ownVideo(tx, input.creatorId, input.videoId, true);
    assertAllowed("upload", video, "This video's file can't be replaced now.");
    const maxBytes = MAX_UPLOAD_BYTES[video.type];
    if (input.uploadLength > maxBytes) {
      throw new StudioError("too_large", `Files can be up to ${Math.round(maxBytes / 1024 ** 3)} GB.`);
    }

    const upload = await stream.createTusUpload({
      uploadLength: input.uploadLength,
      name: video.title,
      maxDurationSeconds: video.type === "community" ? COMMUNITY_MAX_DURATION_SECONDS : PROFESSIONAL_MAX_DURATION_SECONDS,
      creatorId: input.creatorId,
      requireSignedURLs: video.requireSignedUrls,
      watermarkUid: input.watermarkUid,
    });
    await tx
      .update(videos)
      .set({ ...FRESH_FILE, status: "uploading", cloudflareUid: upload.uid, watermarkApplied: Boolean(input.watermarkUid) })
      .where(eq(videos.id, video.id));
    if (video.status !== "uploading") {
      await tx.insert(videoReviews).values({
        videoId: video.id,
        action: "resubmit",
        fromStatus: video.status,
        toStatus: "uploading",
        notes: "Uploaded a new file.",
        createdAt: now,
      });
    }
    return { uploadURL: upload.uploadURL, replacedUid: video.cloudflareUid };
  });
}

export type UploadChecker = Pick<StreamClient, "getVideo">;

/**
 * The browser says the upload finished: confirm with Stream that the file
 * arrived, then show the video as processing until Stream's webhook says it is
 * ready. Only moves "uploading" forward, so a webhook that came first wins.
 */
export async function markUploaded(db: Database, stream: UploadChecker, creatorId: string, videoId: string): Promise<Video> {
  const video = await ownVideo(db, creatorId, videoId);
  if (video.status !== "uploading" || !video.cloudflareUid) return video;
  const remote = await stream.getVideo(video.cloudflareUid);
  if (remote.status?.state === "pendingupload") return video;
  const [updated] = await db
    .update(videos)
    .set({ status: "processing" })
    .where(and(eq(videos.id, video.id), eq(videos.status, "uploading"), eq(videos.cloudflareUid, video.cloudflareUid)))
    .returning();
  return updated ?? (await ownVideo(db, creatorId, videoId));
}

/**
 * Send a video back for review after a change request (typically after editing
 * its details). It is screened again, and a person reviews it.
 */
export async function resubmit(db: Database, creatorId: string, videoId: string, note: string | null, now: Date = new Date()): Promise<Video> {
  return db.transaction(async (tx) => {
    const video = await ownVideo(tx, creatorId, videoId, true);
    assertAllowed("resubmit", video, "Only videos with requested changes can be resubmitted.");
    const [updated] = await tx
      .update(videos)
      .set({
        status: "pending_review",
        reviewDueAt: reviewDueAt(video.type, now),
        // Keep the transcript (same file); screen the new details again.
        moderation: null,
        screenedAt: null,
        aiRisk: null,
        aiRecommendation: null,
      })
      .where(eq(videos.id, video.id))
      .returning();
    await tx.insert(videoReviews).values({
      videoId: video.id,
      action: "resubmit",
      fromStatus: video.status,
      toStatus: "pending_review",
      notes: note?.trim() || null,
      createdAt: now,
    });
    return updated!;
  });
}

/** Delete an unpublished video. Returns its Stream uid for the caller to delete from Stream. */
export async function deleteVideo(db: Database, creatorId: string, videoId: string): Promise<{ cloudflareUid: string | null }> {
  return db.transaction(async (tx) => {
    const video = await ownVideo(tx, creatorId, videoId, true);
    assertAllowed("delete", video, "Published videos can't be deleted here. Write to us to take one down.");
    await tx.delete(videos).where(eq(videos.id, video.id));
    return { cloudflareUid: video.cloudflareUid };
  });
}
