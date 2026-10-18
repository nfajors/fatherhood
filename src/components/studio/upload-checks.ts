/** Checks run in the browser before an upload starts. Pure, so they're unit-tested. */
import { COMMUNITY_MAX_DURATION_SECONDS, MAX_UPLOAD_BYTES } from "@/lib/config";
import type { VideoType } from "@/lib/db/schema";

/** Why this file can't be uploaded, or null. Unknown duration passes: Cloudflare enforces the cap anyway. */
export function fileProblem(file: { size: number; type: string }, durationSeconds: number | null, type: VideoType): string | null {
  if (file.type && !file.type.startsWith("video/")) return "That file isn't a video. Choose an MP4, MOV or similar.";
  if (file.size > MAX_UPLOAD_BYTES[type]) return `That file is over ${Math.round(MAX_UPLOAD_BYTES[type] / 1024 ** 3)} GB. Export it at a lower resolution and try again.`;
  if (type === "community" && durationSeconds !== null && durationSeconds > COMMUNITY_MAX_DURATION_SECONDS) {
    const minutes = Math.floor(durationSeconds / 60);
    const seconds = Math.round(durationSeconds % 60);
    return `This video is ${minutes}:${String(seconds).padStart(2, "0")} long. Community Voices videos can be up to 8 minutes, so trim it first.`;
  }
  return null;
}

/** The message to show for a failed upload: the server's own explanation when there is one. */
export function uploadErrorMessage(error: unknown): string {
  const response = (error as { originalResponse?: { getStatus(): number; getBody(): string } | null }).originalResponse;
  if (response) {
    try {
      const body = JSON.parse(response.getBody()) as { message?: string };
      if (body.message) return body.message;
    } catch {
      // not JSON: fall through
    }
    if (response.getStatus() === 401) return "Your session ended. Sign in again, then resume the upload.";
  }
  return "The upload stopped. Check your connection, then resume: it picks up where it left off.";
}

/** "12.4 MB of 640 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024 ** 2) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
