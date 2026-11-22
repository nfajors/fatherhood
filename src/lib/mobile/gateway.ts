/** The Cloudflare Stream side of offline downloads. */
import { signPlaybackToken, streamFromEnv } from "@/lib/stream";
import type { DownloadGateway } from "./downloads";

/** Null when Stream isn't configured. */
export async function streamDownloadGateway(): Promise<DownloadGateway | null> {
  let stream;
  try {
    stream = await streamFromEnv();
  } catch {
    return null;
  }
  const { client, env } = stream;
  return {
    prepare: (uid) => client.enableDownload(uid),
    signedUrl: async (uid, ttlSeconds) =>
      client.downloadUrl(
        await signPlaybackToken({
          videoUid: uid,
          keyId: env.CLOUDFLARE_STREAM_SIGNING_KEY_ID,
          jwkBase64: env.CLOUDFLARE_STREAM_SIGNING_KEY_JWK,
          ttlSeconds,
          downloadable: true,
        }),
      ),
  };
}
