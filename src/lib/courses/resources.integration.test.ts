/**
 * Lesson downloads against a real Postgres with an in-memory stand-in for R2.
 * Runs only when TEST_DATABASE_URL points at a disposable database (tables
 * are truncated).
 */
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "@/lib/auth";
import type { Database } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { addLesson, addModule, createCourse, setPublished } from "./admin";
import { getCourseOutline } from "./catalog";
import {
  addResource,
  deleteResource,
  downloadDecision,
  fileProblem,
  lessonResourceList,
  moveResource,
  prepareUpload,
  ResourceError,
  safeFileName,
  updateResource,
} from "./resources";

const url = process.env.TEST_DATABASE_URL;

/** Stands in for R2: "uploading" puts a key in the map. */
class FakeStorage {
  objects = new Map<string, { size: number; contentType: string }>();
  async presignUpload(key: string, contentType: string) {
    return `https://r2.test/${key}?type=${encodeURIComponent(contentType)}`;
  }
  async head(key: string) {
    return this.objects.get(key) ?? null;
  }
}

const person = (id: string, role: SessionUser["role"] = "user"): SessionUser => ({ id, role, email: `${id}@test.dev`, name: id, stripeCustomerId: null });
const pdf = { fileName: "Week 1 workbook.pdf", contentType: "application/pdf", size: 120_000 };

describe("fileProblem and safeFileName", () => {
  it("accepts documents and images, checking type, extension and size", () => {
    expect(fileProblem(pdf)).toBeNull();
    expect(fileProblem({ fileName: "card.JPG", contentType: "image/jpeg", size: 1 })).toBeNull();
    expect(fileProblem({ fileName: "setup.exe", contentType: "application/octet-stream", size: 1 })).toMatch(/Upload a PDF/);
    expect(fileProblem({ fileName: "notes.docx", contentType: "application/pdf", size: 1 })).toMatch(/end in \.pdf/);
    expect(fileProblem({ ...pdf, size: 0 })).toMatch(/empty/);
    expect(fileProblem({ ...pdf, size: 51 * 1024 * 1024 })).toMatch(/up to 50 MB/);
  });

  it("keeps names readable but safe", () => {
    expect(safeFileName("  Père's   notes: v2?.pdf ")).toBe("Père's notes- v2-.pdf");
    expect(safeFileName("../../etc/passwd")).toBe("..-..-etc-passwd");
    expect(safeFileName("")).toBe("download");
  });
});

describe.skipIf(!url)("lesson downloads (Postgres)", () => {
  let client: postgres.Sql;
  let db: Database;
  let storage: FakeStorage;

  beforeAll(async () => {
    client = postgres(url!, { max: 4, onnotice: () => {} });
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: "drizzle" });
  });

  afterAll(async () => {
    await client?.end();
  });

  beforeEach(async () => {
    await db.execute(sql`truncate lesson_resources, lessons, course_modules, courses, subscriptions, videos, "user" cascade`);
    await db.insert(schema.user).values([
      { id: "author", name: "The Author", email: "author@test.dev", role: "admin" },
      { id: "member", name: "Member", email: "member@test.dev" },
      { id: "visitor", name: "Visitor", email: "visitor@test.dev" },
    ]);
    await db.insert(schema.subscriptions).values({ userId: "member", plan: "annual", status: "active", currentPeriodEnd: new Date("2030-01-01") });
    storage = new FakeStorage();
  });

  /** A published course with a paid lesson and a free preview lesson. */
  async function course() {
    const [paidVideo, previewVideo] = await db
      .insert(schema.videos)
      .values([
        { type: "professional", status: "approved", creatorId: "author", title: "Paid", cloudflareUid: "p1", requireSignedUrls: true },
        { type: "professional", status: "approved", creatorId: "author", title: "Preview", cloudflareUid: "p2", requireSignedUrls: true },
      ])
      .returning();
    const c = await createCourse(db, { title: "Why Fathers Matter" });
    const m = await addModule(db, c.id, "The evidence");
    const paid = await addLesson(db, m.id, { title: "Paid lesson", videoId: paidVideo!.id });
    const preview = await addLesson(db, m.id, { title: "Preview lesson", videoId: previewVideo!.id, isPreview: true });
    await setPublished(db, c.id, true);
    return { course: c, paid, preview };
  }

  /** Upload a file the way the browser does: presign, "PUT", then attach. */
  async function upload(lessonId: string, title: string, file = pdf) {
    const prepared = await prepareUpload(db, storage, lessonId, file);
    storage.objects.set(prepared.key, { size: file.size, contentType: file.contentType });
    return addResource(db, storage, { lessonId, key: prepared.key, title, kind: "workbook" });
  }

  it("presigns an upload under the lesson's prefix, then records it once the file is there", async () => {
    const { paid } = await course();
    const prepared = await prepareUpload(db, storage, paid.id, pdf);
    expect(prepared.key).toMatch(new RegExp(`^lessons/${paid.id}/[0-9a-f-]{36}/Week 1 workbook\\.pdf$`));
    expect(prepared.uploadUrl).toContain("type=application%2Fpdf");

    // Not uploaded yet.
    await expect(addResource(db, storage, { lessonId: paid.id, key: prepared.key, title: "Workbook", kind: "workbook" })).rejects.toMatchObject({ reason: "not_uploaded" });
    storage.objects.set(prepared.key, { size: 119_999, contentType: "application/pdf" });
    const resource = await addResource(db, storage, { lessonId: paid.id, key: prepared.key, title: " Workbook ", kind: "workbook" });
    // Size and type come from what R2 actually holds.
    expect(resource).toMatchObject({ title: "Workbook", fileName: "Week 1 workbook.pdf", sizeBytes: 119_999, contentType: "application/pdf", position: 1 });

    await expect(prepareUpload(db, storage, paid.id, { ...pdf, contentType: "text/html", fileName: "x.html" })).rejects.toMatchObject({ reason: "invalid_file" });
    await expect(prepareUpload(db, storage, "00000000-0000-4000-8000-000000000000", pdf)).rejects.toMatchObject({ reason: "not_found" });
  });

  it("refuses a key from another lesson, and an oversized file swapped in after presigning", async () => {
    const { paid, preview } = await course();
    const prepared = await prepareUpload(db, storage, paid.id, pdf);
    storage.objects.set(prepared.key, { size: 1, contentType: "application/pdf" });
    await expect(addResource(db, storage, { lessonId: preview.id, key: prepared.key, title: "Stolen", kind: "pdf" })).rejects.toMatchObject({ reason: "invalid_file" });
    storage.objects.set(prepared.key, { size: 60 * 1024 * 1024, contentType: "application/pdf" });
    await expect(addResource(db, storage, { lessonId: paid.id, key: prepared.key, title: "Huge", kind: "pdf" })).rejects.toBeInstanceOf(ResourceError);
  });

  it("orders, renames, reorders and deletes, and shows in the course outline", async () => {
    const { course: c, paid } = await course();
    const a = await upload(paid.id, "Workbook");
    const b = await upload(paid.id, "Insight card", { fileName: "card.png", contentType: "image/png", size: 5000 });
    expect((await lessonResourceList(db, paid.id)).map((r) => r.title)).toEqual(["Workbook", "Insight card"]);
    expect(await moveResource(db, b.id, "up")).toBe(true);
    expect(await moveResource(db, b.id, "up")).toBe(false);
    await updateResource(db, a.id, { title: "Reflection workbook", kind: "pdf" });
    expect((await lessonResourceList(db, paid.id)).map((r) => [r.title, r.kind])).toEqual([
      ["Insight card", "workbook"],
      ["Reflection workbook", "pdf"],
    ]);

    const outline = (await getCourseOutline(db, c.slug, null))!;
    expect(outline.flat[0]!.resources).toEqual([
      { id: b.id, title: "Insight card", kind: "workbook", fileName: "card.png", sizeBytes: 5000 },
      { id: a.id, title: "Reflection workbook", kind: "pdf", fileName: "Week 1 workbook.pdf", sizeBytes: 120_000 },
    ]);

    expect(await deleteResource(db, a.id)).toEqual({ key: expect.stringMatching(/^lessons\//) });
    await expect(deleteResource(db, a.id)).rejects.toMatchObject({ reason: "not_found" });
  });

  it("lets members download, and everyone download from a free preview lesson", async () => {
    const { paid, preview } = await course();
    const paidFile = await upload(paid.id, "Paid workbook");
    const previewFile = await upload(preview.id, "Preview workbook");

    expect(await downloadDecision(db, paidFile.id, null)).toEqual({ result: "denied", signedIn: false });
    expect(await downloadDecision(db, paidFile.id, person("visitor"))).toEqual({ result: "denied", signedIn: true });
    expect(await downloadDecision(db, paidFile.id, person("member"))).toEqual({ result: "allowed", key: paidFile.r2Key, fileName: "Week 1 workbook.pdf" });
    expect(await downloadDecision(db, previewFile.id, null)).toMatchObject({ result: "allowed" });
    expect(await downloadDecision(db, "00000000-0000-4000-8000-000000000000", person("member"))).toEqual({ result: "not_found" });
  });

  it("hides files of draft courses and unapproved lessons from everyone but admins", async () => {
    const { course: c, paid } = await course();
    const file = await upload(paid.id, "Workbook");
    await setPublished(db, c.id, false);
    expect(await downloadDecision(db, file.id, person("member"))).toEqual({ result: "not_found" });
    expect(await downloadDecision(db, file.id, person("author", "admin"))).toMatchObject({ result: "allowed" });

    await setPublished(db, c.id, true);
    const [lesson] = await db.select().from(schema.lessons).where(eq(schema.lessons.id, paid.id));
    await db.update(schema.videos).set({ status: "unpublished" }).where(eq(schema.videos.id, lesson!.videoId!));
    expect(await downloadDecision(db, file.id, person("member"))).toMatchObject({ result: "denied" });
  });
});
