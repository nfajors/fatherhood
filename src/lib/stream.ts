/**
 * Cloudflare Stream client: direct creator uploads, video metadata, watermark
 * profiles, signed playback tokens and webhook verification.
 *
 * Ported from winning-backend-staging app/services/video/cloudflare_stream_service.py,
 * with two corrections against Cloudflare's documented API:
 * - Signed playback tokens are RS256 JWTs signed with a key from POST /stream/keys
 *   (the Winning version used HS256 and a made-up key id, which Stream rejects).
 * - Watermarks are applied by passing a watermark profile uid at upload time;
 *   there is no per-video watermark endpoint.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { importJWK, SignJWT, type JWK } from "jose";

const API_BASE = "https://api.cloudflare.com/client/v4";

export type StreamConfig = {
  accountId: string;
  apiToken: string;
  /** Subdomain code from https://customer-<code>.cloudflarestream.com */
  customerCode: string;
  fetch?: typeof fetch;
};

/** The subset of Stream's video object this app uses. */
export type StreamVideo = {
  uid: string;
  readyToStream: boolean;
  status: { state: "pendingupload" | "downloading" | "queued" | "inprogress" | "ready" | "error"; errorReasonCode?: string; errorReasonText?: string };
  duration: number;
  thumbnail?: string;
  requireSignedURLs: boolean;
  creator?: string | null;
  meta?: Record<string, string>;
  watermark?: { uid: string } | null;
};

export type DirectUploadOptions = {
  /** Cloudflare rejects uploads longer than this. */
  maxDurationSeconds: number;
  /** Our user id, recorded on the Stream video for traceability. */
  creatorId: string;
  requireSignedURLs: boolean;
  watermarkUid?: string;
  meta?: Record<string, string>;
  /** How long the one-time upload URL stays valid (Stream allows up to 6 hours). */
  expiresInSeconds?: number;
};

export type WatermarkPosition = "upperRight" | "upperLeft" | "lowerLeft" | "lowerRight" | "center";

export class StreamApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "StreamApiError";
  }
}

type Envelope<T> = { success: boolean; result: T; errors?: { code: number; message: string }[] };

export class StreamClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: StreamConfig) {
    this.fetchImpl = config.fetch ?? fetch;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${API_BASE}/accounts/${this.config.accountId}/stream${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.config.apiToken}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as Envelope<T> | null;
    if (!res.ok || !json?.success) {
      const detail = json?.errors?.map((e) => e.message).join("; ") || res.statusText;
      throw new StreamApiError(`Cloudflare Stream ${method} ${path} failed: ${detail}`, res.status);
    }
    return json.result;
  }

  /** One-time URL the browser uploads to directly (basic POST, or tus for large files). */
  async createDirectUpload(options: DirectUploadOptions): Promise<{ uploadURL: string; uid: string }> {
    const expiresIn = options.expiresInSeconds ?? 60 * 60;
    return this.request("POST", "/direct_upload", {
      maxDurationSeconds: options.maxDurationSeconds,
      expiry: new Date(Date.now() + expiresIn * 1000).toISOString(),
      creator: options.creatorId,
      requireSignedURLs: options.requireSignedURLs,
      thumbnailTimestampPct: 0.1,
      meta: options.meta ?? {},
      ...(options.watermarkUid ? { watermark: { uid: options.watermarkUid } } : {}),
    });
  }

  /**
   * Start a resumable (tus) direct upload of `uploadLength` bytes. The browser
   * sends the file in chunks straight to the returned URL. Settings travel as
   * tus Upload-Metadata and are always set here, never taken from the browser.
   */
  async createTusUpload(options: DirectUploadOptions & { uploadLength: number; name: string }): Promise<{ uploadURL: string; uid: string }> {
    const expiresIn = options.expiresInSeconds ?? 6 * 60 * 60;
    const res = await this.fetchImpl(`${API_BASE}/accounts/${this.config.accountId}/stream?direct_user=true`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiToken}`,
        "Tus-Resumable": "1.0.0",
        "Upload-Length": String(options.uploadLength),
        "Upload-Creator": options.creatorId,
        "Upload-Metadata": tusMetadata({
          name: options.name,
          maxDurationSeconds: String(options.maxDurationSeconds),
          expiry: new Date(Date.now() + expiresIn * 1000).toISOString(),
          thumbnailtimestamppct: "0.1",
          requiresignedurls: options.requireSignedURLs ? true : undefined,
          watermark: options.watermarkUid,
        }),
      },
    });
    const uploadURL = res.headers.get("location");
    const uid = res.headers.get("stream-media-id");
    if (!res.ok || !uploadURL || !uid) {
      const detail = await res.text().catch(() => "");
      throw new StreamApiError(`Cloudflare Stream tus upload failed: ${res.status} ${detail || res.statusText}`.trim(), res.status);
    }
    return { uploadURL, uid };
  }

  async getVideo(uid: string): Promise<StreamVideo> {
    return this.request("GET", `/${encodeURIComponent(uid)}`);
  }

  async updateVideo(
    uid: string,
    changes: { requireSignedURLs?: boolean; meta?: Record<string, string> },
  ): Promise<StreamVideo> {
    return this.request("POST", `/${encodeURIComponent(uid)}`, changes);
  }

  async deleteVideo(uid: string): Promise<void> {
    await this.request("DELETE", `/${encodeURIComponent(uid)}`);
  }

  /** Create a reusable watermark profile from a hosted PNG; returns its uid. */
  async createWatermarkProfile(options: {
    url: string;
    name: string;
    opacity?: number;
    padding?: number;
    scale?: number;
    position?: WatermarkPosition;
  }): Promise<string> {
    const result = await this.request<{ uid: string }>("POST", "/watermarks", {
      url: options.url,
      name: options.name,
      opacity: options.opacity ?? 0.8,
      padding: options.padding ?? 0.05,
      scale: options.scale ?? 0.12,
      position: options.position ?? "lowerRight",
    });
    return result.uid;
  }

  /**
   * Ask Stream to generate captions with its speech-to-text model. The result
   * is the transcript the moderation screen reads.
   */
  async generateCaptions(uid: string, language = "en"): Promise<void> {
    await this.request("POST", `/${encodeURIComponent(uid)}/captions/${language}/generate`);
  }

  /** Status of a video's captions in one language: none until generation is requested. */
  async captionStatus(uid: string, language = "en"): Promise<"none" | "inprogress" | "ready" | "error"> {
    const captions = await this.request<{ language: string; status?: string }[]>("GET", `/${encodeURIComponent(uid)}/captions`);
    const match = captions.find((c) => c.language === language);
    if (!match) return "none";
    // Uploaded caption files have no status; they are ready.
    return match.status === "inprogress" || match.status === "error" ? match.status : "ready";
  }

  /** The captions as WebVTT text (this endpoint returns the file, not a JSON envelope). */
  async captionVtt(uid: string, language = "en"): Promise<string> {
    const path = `/${encodeURIComponent(uid)}/captions/${language}/vtt`;
    const res = await this.fetchImpl(`${API_BASE}/accounts/${this.config.accountId}/stream${path}`, {
      headers: { Authorization: `Bearer ${this.config.apiToken}` },
    });
    if (!res.ok) throw new StreamApiError(`Cloudflare Stream GET ${path} failed: ${res.statusText}`, res.status);
    return res.text();
  }

  /** A still frame at `seconds` into the video (pass a signed token instead of the uid for signed videos). */
  frameUrl(uidOrToken: string, seconds: number, height = 480): string {
    return `${this.playbackUrls(uidOrToken).thumbnail}?time=${Math.max(0, Math.round(seconds))}s&height=${height}`;
  }

  /** Playback URLs for a video uid, or for a signed token (which replaces the uid). */
  playbackUrls(uidOrToken: string) {
    const base = `https://customer-${this.config.customerCode}.cloudflarestream.com/${uidOrToken}`;
    return {
      iframe: `${base}/iframe`,
      hls: `${base}/manifest/video.m3u8`,
      dash: `${base}/manifest/video.mpd`,
      thumbnail: `${base}/thumbnails/thumbnail.jpg`,
    };
  }
}

/**
 * tus Upload-Metadata: comma-separated `key base64(value)` pairs; `true` sends
 * a bare key (a flag) and undefined values are left out.
 */
export function tusMetadata(values: Record<string, string | true | undefined>): string {
  return Object.entries(values)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => (v === true ? k : `${k} ${Buffer.from(v as string, "utf8").toString("base64")}`))
    .join(",");
}

/**
 * Sign a playback token for a video that requires signed URLs. `jwkBase64` is
 * the base64 "jwk" value returned by POST /accounts/{id}/stream/keys.
 */
export async function signPlaybackToken(options: {
  videoUid: string;
  keyId: string;
  jwkBase64: string;
  ttlSeconds: number;
  now?: Date;
}): Promise<string> {
  const jwk = JSON.parse(Buffer.from(options.jwkBase64, "base64").toString("utf8")) as JWK;
  const key = await importJWK(jwk, "RS256");
  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  return new SignJWT({ kid: options.keyId })
    .setProtectedHeader({ alg: "RS256", kid: options.keyId })
    .setSubject(options.videoUid)
    // Small clock-skew allowance for viewers whose clocks run slow.
    .setNotBefore(nowSeconds - 60)
    .setExpirationTime(nowSeconds + options.ttlSeconds)
    .sign(key);
}

/**
 * Verify Stream's `Webhook-Signature: time=<unix>,sig1=<hex>` header: an
 * HMAC-SHA256 of `${time}.${rawBody}` with the account's webhook secret.
 */
export function verifyStreamWebhook(options: {
  rawBody: string;
  signatureHeader: string | null;
  secret: string;
  toleranceSeconds?: number;
  now?: Date;
}): boolean {
  if (!options.signatureHeader) return false;
  const parts = Object.fromEntries(
    options.signatureHeader.split(",").map((part) => {
      const [k, ...v] = part.trim().split("=");
      return [k, v.join("=")];
    }),
  );
  const time = Number(parts.time);
  const sig = parts.sig1;
  if (!Number.isFinite(time) || !sig) return false;

  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  if (Math.abs(nowSeconds - time) > (options.toleranceSeconds ?? 300)) return false;

  const expected = createHmac("sha256", options.secret).update(`${parts.time}.${options.rawBody}`).digest();
  const given = Buffer.from(sig, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Stream client configured from environment variables. */
export async function streamFromEnv() {
  const { streamEnv } = await import("@/lib/env");
  const env = streamEnv();
  return {
    env,
    client: new StreamClient({
      accountId: env.CLOUDFLARE_ACCOUNT_ID,
      apiToken: env.CLOUDFLARE_STREAM_API_TOKEN,
      customerCode: env.CLOUDFLARE_STREAM_CUSTOMER_CODE,
    }),
  };
}
