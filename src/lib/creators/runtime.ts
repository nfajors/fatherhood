/** Production wiring for the Studio: Stream cleanup and creator notifications. */
import { getMailer } from "@/lib/email";
import { appUrl } from "@/lib/env";
import { streamFromEnv } from "@/lib/stream";

/** Remove a replaced or deleted file from Stream. Best effort: a leftover file costs storage, not correctness. */
export async function deleteFromStream(uid: string): Promise<void> {
  try {
    const { client } = await streamFromEnv();
    await client.deleteVideo(uid);
  } catch (error) {
    console.error(`Stream video ${uid}: delete failed`, error);
  }
}

/** How Fellow decisions reach the applicant. */
export function fellowNotifier() {
  return { mailer: getMailer(), studioUrl: `${appUrl()}/studio` };
}
