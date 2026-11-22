/**
 * Where he got to in videos watched offline, kept until the app is online and
 * sends them to /api/mobile/v1/progress. One record per video: the latest.
 */
export type QueuedProgress = { videoId: string; positionSeconds: number; completed: boolean; recordedAt: string };

export const MAX_QUEUED = 200;

export function queueProgress(queue: QueuedProgress[], item: QueuedProgress): QueuedProgress[] {
  const previous = queue.find((q) => q.videoId === item.videoId);
  const merged = { ...item, completed: item.completed || (previous?.completed ?? false) };
  return [...queue.filter((q) => q.videoId !== item.videoId), merged].slice(-MAX_QUEUED);
}

/** Drop what the server has taken (anything queued again since stays). */
export function afterSync(queue: QueuedProgress[], sent: QueuedProgress[]): QueuedProgress[] {
  return queue.filter((q) => !sent.some((s) => s.videoId === q.videoId && s.recordedAt === q.recordedAt));
}

/** Within the last few seconds of a video counts as finished (as on the website). */
export function isFinished(position: number, duration: number | null | undefined): boolean {
  if (!duration || duration <= 0) return false;
  return position >= duration * 0.9 || duration - position <= 30;
}

/** Where to resume: a few seconds before his place, or the start if he'd finished. */
export function resumeAt(positionSeconds: number, durationSeconds: number | null | undefined, completed: boolean): number {
  if (!positionSeconds || completed) return 0;
  if (durationSeconds && durationSeconds - positionSeconds < 10) return 0;
  return Math.max(0, Math.floor(positionSeconds - 3));
}
