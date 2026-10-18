/** Watch sessions and progress: what the player's heartbeats write. */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { videos, watchProgress, watchSessions } from "@/lib/db/schema";
import { becameView, creditWatchTime, isComplete } from "./progress";

export class PlaybackError extends Error {
  constructor(
    readonly reason: "session_mismatch",
    message: string,
  ) {
    super(message);
  }
}

export type Heartbeat = {
  videoId: string;
  /** Null for anonymous viewers of free Community videos. */
  userId: string | null;
  /** Null on the first heartbeat; the server returns one to send next time. */
  sessionId: string | null;
  positionSeconds: number;
  /** Seconds of playback since the previous heartbeat, as the player measured it. */
  watchedSeconds: number;
  ended: boolean;
};

/**
 * Record a heartbeat: extend (or start) the watch session, count a view when
 * it crosses the threshold, and save resume position and completion for
 * signed-in viewers. Callers check the viewer may watch the video first.
 */
export async function recordHeartbeat(
  db: Database,
  beat: Heartbeat,
  now: Date = new Date(),
): Promise<{ sessionId: string; completed: boolean }> {
  const position = Math.max(0, Math.floor(beat.positionSeconds));

  return db.transaction(async (tx) => {
    const [video] = await tx
      .select({ durationSeconds: videos.durationSeconds, creatorId: videos.creatorId })
      .from(videos)
      .where(eq(videos.id, beat.videoId));
    const duration = video?.durationSeconds ?? null;
    // Creators watching their own videos keep their place but earn no views (or pool share).
    const ownVideo = beat.userId !== null && beat.userId === video?.creatorId;
    const clampedPosition = duration ? Math.min(position, duration) : position;

    let sessionId = beat.sessionId;
    let before = 0;
    let credited = 0;
    if (sessionId) {
      const [session] = await tx.select().from(watchSessions).where(eq(watchSessions.id, sessionId)).for("update");
      if (!session || session.videoId !== beat.videoId || session.userId !== beat.userId) {
        throw new PlaybackError("session_mismatch", "This playback session belongs to someone else.");
      }
      before = session.secondsWatched;
      credited = ownVideo ? 0 : creditWatchTime(beat.watchedSeconds, session.lastHeartbeatAt, now);
      await tx
        .update(watchSessions)
        .set({
          secondsWatched: before + credited,
          maxPositionSeconds: sql`greatest(${watchSessions.maxPositionSeconds}, ${clampedPosition})`,
          lastHeartbeatAt: now,
        })
        .where(eq(watchSessions.id, sessionId));
    } else {
      // A new session gets no credit yet: there is no earlier heartbeat to measure from.
      const [created] = await tx
        .insert(watchSessions)
        .values({ videoId: beat.videoId, userId: beat.userId, maxPositionSeconds: clampedPosition, startedAt: now, lastHeartbeatAt: now })
        .returning({ id: watchSessions.id });
      sessionId = created!.id;
    }

    if (becameView(before, before + credited)) {
      await tx.update(videos).set({ viewCount: sql`${videos.viewCount} + 1` }).where(eq(videos.id, beat.videoId));
    }

    const completed = isComplete(clampedPosition, duration, beat.ended);
    if (beat.userId) {
      await tx
        .insert(watchProgress)
        .values({ userId: beat.userId, videoId: beat.videoId, positionSeconds: clampedPosition, completed, updatedAt: now })
        .onConflictDoUpdate({
          target: [watchProgress.userId, watchProgress.videoId],
          // Once completed, a lesson stays completed even if it is rewatched.
          set: { positionSeconds: clampedPosition, completed: sql`${watchProgress.completed} or ${completed}`, updatedAt: now },
        });
    }
    return { sessionId, completed };
  });
}

/** Mark a video finished (or not) for a viewer, from the "mark complete" button. */
export async function setCompleted(db: Database, userId: string, videoId: string, completed: boolean, now: Date = new Date()) {
  await db
    .insert(watchProgress)
    .values({ userId, videoId, completed, positionSeconds: 0, updatedAt: now })
    .onConflictDoUpdate({ target: [watchProgress.userId, watchProgress.videoId], set: { completed, updatedAt: now } });
}

export type ProgressRow = { positionSeconds: number; completed: boolean; updatedAt: Date };

export async function progressFor(db: Database, userId: string | null, videoIds: string[]): Promise<Map<string, ProgressRow>> {
  if (!userId || videoIds.length === 0) return new Map();
  const rows = await db
    .select({ videoId: watchProgress.videoId, positionSeconds: watchProgress.positionSeconds, completed: watchProgress.completed, updatedAt: watchProgress.updatedAt })
    .from(watchProgress)
    .where(and(eq(watchProgress.userId, userId), inArray(watchProgress.videoId, videoIds)));
  return new Map(rows.map((r) => [r.videoId, r]));
}
