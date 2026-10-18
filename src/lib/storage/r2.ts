/**
 * Cloudflare R2 (S3-compatible) for lesson downloads: presigned uploads from
 * the admin's browser, presigned short-lived downloads, and HEAD/DELETE from
 * the server. The bucket stays private; nothing is served without a signature.
 */
import { AwsClient } from "aws4fetch";

export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  fetch?: typeof fetch;
};

export class R2Error extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "R2Error";
  }
}

/** Encode each path segment, keeping the slashes. */
const encodeKey = (key: string) => key.split("/").map(encodeURIComponent).join("/");

/** A Content-Disposition that keeps non-ASCII file names intact (RFC 6266). */
export function attachmentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export class R2Storage {
  private readonly client: AwsClient;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: R2Config) {
    this.client = new AwsClient({ accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, service: "s3", region: "auto" });
    this.fetchImpl = config.fetch ?? fetch;
  }

  objectUrl(key: string): URL {
    return new URL(`https://${this.config.accountId}.r2.cloudflarestorage.com/${this.config.bucket}/${encodeKey(key)}`);
  }

  private async presign(method: "GET" | "PUT", url: URL, expiresInSeconds: number, headers?: Record<string, string>): Promise<string> {
    url.searchParams.set("X-Amz-Expires", String(expiresInSeconds));
    // allHeaders: sign the Content-Type too, so the upload must match it.
    const signed = await this.client.sign(url, { method, headers, aws: { signQuery: true, allHeaders: true } });
    return signed.url;
  }

  /**
   * A URL the browser can PUT the file to. The Content-Type is part of the
   * signature, so the upload must send exactly that type.
   */
  presignUpload(key: string, contentType: string, expiresInSeconds = 15 * 60): Promise<string> {
    return this.presign("PUT", this.objectUrl(key), expiresInSeconds, { "content-type": contentType });
  }

  /** A short-lived download link that saves the file under `fileName`. */
  presignDownload(key: string, fileName: string, expiresInSeconds = 5 * 60): Promise<string> {
    const url = this.objectUrl(key);
    url.searchParams.set("response-content-disposition", attachmentDisposition(fileName));
    return this.presign("GET", url, expiresInSeconds);
  }

  /** Size and type of a stored object, or null when it isn't there. */
  async head(key: string): Promise<{ size: number; contentType: string | null } | null> {
    const res = await this.fetchImpl(await this.client.sign(this.objectUrl(key), { method: "HEAD" }));
    if (res.status === 404) return null;
    if (!res.ok) throw new R2Error(`R2 HEAD ${key} failed: ${res.status}`, res.status);
    return { size: Number(res.headers.get("content-length") ?? 0), contentType: res.headers.get("content-type") };
  }

  async delete(key: string): Promise<void> {
    const res = await this.fetchImpl(await this.client.sign(this.objectUrl(key), { method: "DELETE" }));
    // S3 answers 204 whether or not the object existed.
    if (!res.ok && res.status !== 404) throw new R2Error(`R2 DELETE ${key} failed: ${res.status}`, res.status);
  }
}

/** R2 configured from environment variables. */
export async function r2FromEnv(): Promise<R2Storage> {
  const { r2Env } = await import("@/lib/env");
  const env = r2Env();
  return new R2Storage({
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    bucket: env.R2_BUCKET,
  });
}
