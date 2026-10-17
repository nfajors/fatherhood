/** Production wiring for moderation: Cloudflare Stream media and the Claude screener. */
import { getDb } from "@/lib/db";
import { getMailer } from "@/lib/email";
import { themeClassifierConfigured } from "@/lib/env";
import { signPlaybackToken, streamFromEnv } from "@/lib/stream";
import { ClaudeVideoScreener, type VideoScreener } from "./screen";
import { frameTimes, screenVideo, type MediaSource, type Video } from "./service";

/** Frame links must outlive the request; Anthropic fetches them while screening. */
const FRAME_TOKEN_TTL_SECONDS = 60 * 60;

function uid(video: Video): string {
  if (!video.cloudflareUid) throw new Error(`Video ${video.id} has no Stream uid`);
  return video.cloudflareUid;
}

export const streamMedia: MediaSource = {
  async requestCaptions(video) {
    const { client } = await streamFromEnv();
    await client.generateCaptions(uid(video));
  },
  async captionStatus(video) {
    const { client } = await streamFromEnv();
    return client.captionStatus(uid(video));
  },
  async captionVtt(video) {
    const { client } = await streamFromEnv();
    return client.captionVtt(uid(video));
  },
  async frameUrls(video) {
    const { env, client } = await streamFromEnv();
    // Paid videos only serve frames through a signed token.
    const ref = video.requireSignedUrls
      ? await signPlaybackToken({
          videoUid: uid(video),
          keyId: env.CLOUDFLARE_STREAM_SIGNING_KEY_ID,
          jwkBase64: env.CLOUDFLARE_STREAM_SIGNING_KEY_JWK,
          ttlSeconds: FRAME_TOKEN_TTL_SECONDS,
        })
      : uid(video);
    return frameTimes(video.durationSeconds).map((t) => client.frameUrl(ref, t));
  },
};

let screener: VideoScreener | undefined;

/** The Claude screener, or null when no Anthropic key is configured (videos then wait for a human). */
export function getScreener(): VideoScreener | null {
  if (!themeClassifierConfigured()) return null;
  screener ??= new ClaudeVideoScreener();
  return screener;
}

/** Start screening a newly queued video (requests captions); the cron job finishes it. */
export async function startScreening(videoId: string): Promise<void> {
  const active = getScreener();
  if (!active) return;
  try {
    await screenVideo(getDb(), videoId, { media: streamMedia, screener: active, mailer: getMailer() });
  } catch (error) {
    console.error(`Moderation screen failed for video ${videoId}:`, error);
  }
}
