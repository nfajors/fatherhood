import { createHmac } from "node:crypto";
import { exportJWK, generateKeyPair, jwtVerify, decodeProtectedHeader } from "jose";
import { describe, expect, it, vi } from "vitest";
import { signPlaybackToken, StreamApiError, StreamClient, verifyStreamWebhook } from "./stream";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("StreamClient", () => {
  const make = (impl: typeof fetch) =>
    new StreamClient({ accountId: "acct", apiToken: "tok", customerCode: "abc123", fetch: impl });

  it("creates a direct upload with duration cap, signing and watermark", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, result: { uploadURL: "https://upload", uid: "vid1" } }));
    const result = await make(fetchMock as unknown as typeof fetch).createDirectUpload({
      maxDurationSeconds: 480,
      creatorId: "user-1",
      requireSignedURLs: false,
      watermarkUid: "wm1",
      meta: { name: "My story" },
    });

    expect(result).toEqual({ uploadURL: "https://upload", uid: "vid1" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/acct/stream/direct_upload");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      maxDurationSeconds: 480,
      creator: "user-1",
      requireSignedURLs: false,
      watermark: { uid: "wm1" },
      meta: { name: "My story" },
    });
    expect(Date.parse(body.expiry)).toBeGreaterThan(Date.now());
  });

  it("omits the watermark when none is configured", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, result: { uploadURL: "u", uid: "v" } }));
    await make(fetchMock as unknown as typeof fetch).createDirectUpload({
      maxDurationSeconds: 60,
      creatorId: "c",
      requireSignedURLs: true,
    });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).not.toHaveProperty("watermark");
  });

  it("raises StreamApiError with Cloudflare's message on failure", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: false, result: null, errors: [{ code: 10005, message: "bad token" }] }, 403));
    const client = make(fetchMock as unknown as typeof fetch);
    await expect(client.getVideo("v")).rejects.toThrowError(StreamApiError);
    await expect(client.getVideo("v")).rejects.toThrowError(/bad token/);
  });

  it("raises on a non-JSON error body", async () => {
    const fetchMock = vi.fn(async () => new Response("gateway down", { status: 502, statusText: "Bad Gateway" }));
    await expect(make(fetchMock as unknown as typeof fetch).deleteVideo("v")).rejects.toThrowError(/Bad Gateway/);
  });

  it("gets, updates and deletes videos at the right paths", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, result: { uid: "v" } }));
    const client = make(fetchMock as unknown as typeof fetch);
    await client.getVideo("v");
    await client.updateVideo("v", { requireSignedURLs: true });
    await client.deleteVideo("v");
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map(([u, i]) => `${i.method} ${u.split("/stream")[1]}`)).toEqual(["GET /v", "POST /v", "DELETE /v"]);
    expect(JSON.parse(calls[1]![1].body as string)).toEqual({ requireSignedURLs: true });
  });

  it("creates a watermark profile with brand defaults", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, result: { uid: "wm9" } }));
    const uid = await make(fetchMock as unknown as typeof fetch).createWatermarkProfile({ url: "https://x/logo.png", name: "Brand" });
    expect(uid).toBe("wm9");
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      url: "https://x/logo.png",
      name: "Brand",
      opacity: 0.8,
      padding: 0.05,
      scale: 0.12,
      position: "lowerRight",
    });
  });

  it("requests captions and reads their status and VTT", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/captions")) return jsonResponse({ success: true, result: [{ language: "en", status: "inprogress" }] });
      if (url.endsWith("/vtt")) return new Response("WEBVTT\n\n00:00.000 --> 00:01.000\nHi\n");
      return jsonResponse({ success: true, result: {} });
    });
    const client = make(fetchMock as unknown as typeof fetch);
    await client.generateCaptions("v");
    expect(await client.captionStatus("v")).toBe("inprogress");
    expect(await client.captionStatus("v", "fr")).toBe("none");
    expect(await client.captionVtt("v")).toContain("Hi");
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(`${calls[0]![1].method} ${calls[0]![0].split("/stream")[1]}`).toBe("POST /v/captions/en/generate");
  });

  it("treats uploaded captions (no status) as ready, and reports VTT errors", async () => {
    const ready = make(vi.fn(async () => jsonResponse({ success: true, result: [{ language: "en" }] })) as unknown as typeof fetch);
    expect(await ready.captionStatus("v")).toBe("ready");
    const missing = make(vi.fn(async () => new Response("no", { status: 404, statusText: "Not Found" })) as unknown as typeof fetch);
    await expect(missing.captionVtt("v")).rejects.toThrowError(/Not Found/);
  });

  it("builds frame URLs at whole seconds", () => {
    expect(make(fetch).frameUrl("tok", 12.6)).toBe("https://customer-abc123.cloudflarestream.com/tok/thumbnails/thumbnail.jpg?time=13s&height=480");
    expect(make(fetch).frameUrl("tok", -5, 240)).toContain("?time=0s&height=240");
  });

  it("builds customer-domain playback URLs", () => {
    const urls = make(fetch).playbackUrls("tokenOrUid");
    expect(urls.hls).toBe("https://customer-abc123.cloudflarestream.com/tokenOrUid/manifest/video.m3u8");
    expect(urls.iframe).toBe("https://customer-abc123.cloudflarestream.com/tokenOrUid/iframe");
  });
});

describe("signPlaybackToken", () => {
  it("produces an RS256 token Cloudflare can verify with the public key", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
    const jwkBase64 = Buffer.from(JSON.stringify(await exportJWK(privateKey))).toString("base64");
    const now = new Date();

    const token = await signPlaybackToken({ videoUid: "vid1", keyId: "key1", jwkBase64, ttlSeconds: 600, now });

    expect(decodeProtectedHeader(token)).toEqual({ alg: "RS256", kid: "key1" });
    const { payload } = await jwtVerify(token, publicKey);
    const nowSeconds = Math.floor(now.getTime() / 1000);
    expect(payload.sub).toBe("vid1");
    expect(payload.kid).toBe("key1");
    expect(payload.exp).toBe(nowSeconds + 600);
    expect(payload.nbf).toBe(nowSeconds - 60);
  });
});

describe("verifyStreamWebhook", () => {
  const secret = "webhook-secret";
  const rawBody = JSON.stringify({ uid: "vid1", readyToStream: true });
  const now = new Date("2026-10-17T12:00:00Z");
  const time = Math.floor(now.getTime() / 1000);
  const sign = (t: number, body = rawBody) => createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");

  it("accepts a valid signature", () => {
    expect(verifyStreamWebhook({ rawBody, secret, now, signatureHeader: `time=${time},sig1=${sign(time)}` })).toBe(true);
  });

  it("rejects a tampered body", () => {
    expect(
      verifyStreamWebhook({ rawBody: rawBody.replace("vid1", "vid2"), secret, now, signatureHeader: `time=${time},sig1=${sign(time)}` }),
    ).toBe(false);
  });

  it("rejects a stale timestamp (replay)", () => {
    const old = time - 301;
    expect(verifyStreamWebhook({ rawBody, secret, now, signatureHeader: `time=${old},sig1=${sign(old)}` })).toBe(false);
  });

  it("rejects missing or malformed headers", () => {
    expect(verifyStreamWebhook({ rawBody, secret, now, signatureHeader: null })).toBe(false);
    expect(verifyStreamWebhook({ rawBody, secret, now, signatureHeader: "garbage" })).toBe(false);
    expect(verifyStreamWebhook({ rawBody, secret, now, signatureHeader: `time=${time},sig1=abcd` })).toBe(false);
  });
});
