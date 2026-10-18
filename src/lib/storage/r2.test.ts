import { describe, expect, it, vi } from "vitest";
import { attachmentDisposition, R2Error, R2Storage } from "./r2";

const make = (impl?: typeof fetch) =>
  new R2Storage({ accountId: "acct", accessKeyId: "AKID", secretAccessKey: "secret", bucket: "lessons", fetch: impl });

describe("R2Storage", () => {
  it("presigns an upload bound to the content type, expiring in 15 minutes", async () => {
    const url = new URL(await make().presignUpload("lessons/abc/workbook one.pdf", "application/pdf"));
    expect(url.origin + url.pathname).toBe("https://acct.r2.cloudflarestorage.com/lessons/lessons/abc/workbook%20one.pdf");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(url.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(url.searchParams.get("X-Amz-Credential")).toMatch(/^AKID\/\d{8}\/auto\/s3\/aws4_request$/);
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain("content-type");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("presigns a short download that saves under the given name", async () => {
    const url = new URL(await make().presignDownload("lessons/abc/x.pdf", "Week 1 – Reflection.pdf"));
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("response-content-disposition")).toBe(attachmentDisposition("Week 1 – Reflection.pdf"));
  });

  it("reads an object's size and type, and null when missing", async () => {
    const fetchMock = vi.fn(async (req: Request) =>
      req.url.endsWith("missing.pdf")
        ? new Response(null, { status: 404 })
        : new Response(null, { status: 200, headers: { "content-length": "2048", "content-type": "application/pdf" } }),
    );
    const storage = make(fetchMock as unknown as typeof fetch);
    expect(await storage.head("a/here.pdf")).toEqual({ size: 2048, contentType: "application/pdf" });
    expect(await storage.head("a/missing.pdf")).toBeNull();
    const [req] = fetchMock.mock.calls[0]!;
    expect(req.method).toBe("HEAD");
    expect(req.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 Credential=AKID\//);
  });

  it("deletes, tolerating a missing object, and raises on other failures", async () => {
    const ok = make(vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch);
    await expect(ok.delete("a/b.pdf")).resolves.toBeUndefined();
    const denied = make(vi.fn(async () => new Response(null, { status: 403 })) as unknown as typeof fetch);
    await expect(denied.delete("a/b.pdf")).rejects.toBeInstanceOf(R2Error);
  });
});

describe("attachmentDisposition", () => {
  it("gives an ASCII fallback and the exact UTF-8 name", () => {
    expect(attachmentDisposition('Père "notes".pdf')).toBe(`attachment; filename="P_re _notes_.pdf"; filename*=UTF-8''P%C3%A8re%20%22notes%22.pdf`);
  });
});
