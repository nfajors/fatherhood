import { getDb } from "@/lib/db";
import { issueForVideo } from "./certificates";

/**
 * Check for newly earned certificates after a response is sent (a lesson was
 * finished or a quiz passed). Failures are logged; the course page checks
 * again when it's next opened.
 */
export async function certifyInBackground(userId: string, videoId: string): Promise<void> {
  try {
    await issueForVideo(getDb(), userId, videoId);
  } catch (error) {
    console.error(`Certificate check failed for user ${userId}, video ${videoId}:`, error);
  }
}
