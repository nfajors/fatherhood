/**
 * Offline viewing in the app. A member asks for a video; once Stream has made
 * its MP4 he gets a short-lived signed link to download it and a 30-day
 * license. The app renews licenses whenever it is online and deletes files
 * whose license ran out or was revoked (membership ended, video withdrawn).
 *
 * Watching offline saves his place and completion when the app syncs, but
 * counts no views and no creator-pool time: those need the online player.
 */
import { and, count, eq, gt, inArray, ne, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { offlineLicenses, videos, watchProgress } from "@/lib/db/schema";
import type { Viewer } from "@/lib/entitlements";
import { accessFor, isMember } from "@/lib/playback/access";
import { licenseExpiry, MOBILE_POLICY } from "./policy";

type Video = typeof videos.$inferSelect;

export interface DownloadGateway {
  /** Ask Stream for the MP4 (idempotent) and report whether it's ready. */
  prepare(uid: string): Promise<{ status: "ready" | "inprogress" | "error"; percentComplete: number }>;
  /** A signed MP4 link for the video, good for `ttlSeconds`. */
  signedUrl(uid: string, ttlSeconds: number): Promise<string>;
}

export class DownloadError extends Error {
  constructor(
    readonly reason: "not_found" | "membership_required" | "not_available" | "limit_reached" | "failed",
    message: string,
  ) {
    super(message);
  }
}

export type DownloadResult =
  | { status: "preparing"; percentComplete: number }
  | { status: "ready"; url: string; urlExpiresAt: string; licenseExpiresAt: string };

/** Why someone may not keep a video offline, or null if he may. */
async function refusal(db: Database, video: Video | undefined, viewer: Viewer): Promise<DownloadError | null> {
  if (!video || video.status !== "approved" || !video.cloudflareUid) return new DownloadError("not_found", "This video isn't available.");
  if (!isMember(viewer)) return new DownloadError("membership_required", "Downloads are for members.");
  const decision = await accessFor(db, video, viewer);
  return decision.allowed ? null : new DownloadError("membership_required", "Downloads are for members.");
}

export async function requestDownload(
  db: Database,
  gateway: DownloadGateway,
  input: { viewer: Viewer; videoId: string; now?: Date },
): Promise<DownloadResult> {
  const now = input.now ?? new Date();
  const video = await db.query.videos.findFirst({ where: eq(videos.id, input.videoId) });
  const refused = await refusal(db, video, input.viewer);
  if (refused) throw refused;
  const userId = input.viewer!.id;

  const [held] = await db
    .select({ n: count() })
    .from(offlineLicenses)
    .where(and(eq(offlineLicenses.userId, userId), gt(offlineLicenses.expiresAt, now), ne(offlineLicenses.videoId, video!.id)));
  if ((held?.n ?? 0) >= MOBILE_POLICY.maxOfflineDownloads) {
    throw new DownloadError("limit_reached", `You can keep ${MOBILE_POLICY.maxOfflineDownloads} videos offline. Remove one to download another.`);
  }

  if (!video!.downloadReadyAt) {
    const prepared = await gateway.prepare(video!.cloudflareUid!);
    if (prepared.status === "error") throw new DownloadError("failed", "This video can't be downloaded right now. You can still stream it.");
    if (prepared.status !== "ready") return { status: "preparing", percentComplete: Math.round(prepared.percentComplete) };
    await db.update(videos).set({ downloadReadyAt: now }).where(eq(videos.id, video!.id));
  }

  const expiresAt = licenseExpiry(now);
  await db
    .insert(offlineLicenses)
    .values({ userId, videoId: video!.id, expiresAt, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: [offlineLicenses.userId, offlineLicenses.videoId], set: { expiresAt, updatedAt: now } });
  const ttl = MOBILE_POLICY.downloadUrlTtlSeconds;
  return {
    status: "ready",
    url: await gateway.signedUrl(video!.cloudflareUid!, ttl),
    urlExpiresAt: new Date(now.getTime() + ttl * 1000).toISOString(),
    licenseExpiresAt: expiresAt.toISOString(),
  };
}

export type LicenseCheck = { videoId: string; status: "valid"; licenseExpiresAt: string } | { videoId: string; status: "revoked" };

/**
 * The app reports what it holds; each license is renewed for another 30 days,
 * or revoked (and the app deletes the file).
 */
export async function checkLicenses(db: Database, input: { viewer: Viewer; videoIds: string[]; now?: Date }): Promise<LicenseCheck[]> {
  const now = input.now ?? new Date();
  const ids = [...new Set(input.videoIds)].slice(0, MOBILE_POLICY.maxOfflineDownloads * 2);
  if (!input.viewer || ids.length === 0) return ids.map((videoId) => ({ videoId, status: "revoked" as const }));
  const userId = input.viewer.id;
  const [rows, held] = await Promise.all([
    db.select().from(videos).where(inArray(videos.id, ids)),
    db.select({ videoId: offlineLicenses.videoId }).from(offlineLicenses).where(and(eq(offlineLicenses.userId, userId), inArray(offlineLicenses.videoId, ids))),
  ]);
  const licensed = new Set(held.map((h) => h.videoId));
  const expiresAt = licenseExpiry(now);
  const results: LicenseCheck[] = [];
  for (const videoId of ids) {
    // Only licenses we issued renew: a file the server never licensed is revoked.
    const refused = licensed.has(videoId) ? await refusal(db, rows.find((r) => r.id === videoId), input.viewer) : true;
    results.push(refused ? { videoId, status: "revoked" } : { videoId, status: "valid", licenseExpiresAt: expiresAt.toISOString() });
  }
  const valid = results.filter((r) => r.status === "valid").map((r) => r.videoId);
  const revoked = results.filter((r) => r.status === "revoked").map((r) => r.videoId);
  if (valid.length) {
    await db.update(offlineLicenses).set({ expiresAt, updatedAt: now }).where(and(eq(offlineLicenses.userId, userId), inArray(offlineLicenses.videoId, valid)));
  }
  if (revoked.length) {
    await db.delete(offlineLicenses).where(and(eq(offlineLicenses.userId, userId), inArray(offlineLicenses.videoId, revoked)));
  }
  return results;
}

/** He removed the download (or signed out): free the slot. */
export async function releaseDownload(db: Database, userId: string, videoId: string): Promise<void> {
  await db.delete(offlineLicenses).where(and(eq(offlineLicenses.userId, userId), eq(offlineLicenses.videoId, videoId)));
}

export type OfflineProgress = { videoId: string; positionSeconds: number; completed: boolean; recordedAt: Date };

/**
 * Save where he got to while offline, for videos he holds a license for. A
 * newer record from another device wins; once completed, a video stays completed.
 */
export async function syncOfflineProgress(db: Database, userId: string, items: OfflineProgress[], now: Date = new Date()): Promise<number> {
  const batch = items.slice(0, MOBILE_POLICY.maxProgressSync);
  if (batch.length === 0) return 0;
  const licensed = await db
    .select({ videoId: offlineLicenses.videoId, durationSeconds: videos.durationSeconds })
    .from(offlineLicenses)
    .innerJoin(videos, eq(videos.id, offlineLicenses.videoId))
    .where(and(eq(offlineLicenses.userId, userId), inArray(offlineLicenses.videoId, batch.map((i) => i.videoId))));
  const durations = new Map(licensed.map((l) => [l.videoId, l.durationSeconds]));
  // Latest record per video.
  const latest = new Map<string, OfflineProgress>();
  for (const item of batch) {
    if (!durations.has(item.videoId)) continue;
    const prev = latest.get(item.videoId);
    if (!prev || item.recordedAt > prev.recordedAt) latest.set(item.videoId, item);
  }
  let saved = 0;
  for (const item of latest.values()) {
    const at = item.recordedAt > now ? now : item.recordedAt;
    const duration = durations.get(item.videoId);
    const position = Math.max(0, Math.floor(duration ? Math.min(item.positionSeconds, duration) : item.positionSeconds));
    const result = await db
      .insert(watchProgress)
      .values({ userId, videoId: item.videoId, positionSeconds: position, completed: item.completed, createdAt: at, updatedAt: at })
      .onConflictDoUpdate({
        target: [watchProgress.userId, watchProgress.videoId],
        set: { positionSeconds: position, completed: sql`${watchProgress.completed} or ${item.completed}`, updatedAt: at },
        setWhere: sql`${watchProgress.updatedAt} < ${at.toISOString()}::timestamptz`,
      })
      .returning({ videoId: watchProgress.videoId });
    saved += result.length;
  }
  return saved;
}
