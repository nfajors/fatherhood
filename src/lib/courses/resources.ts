/**
 * Lesson downloads (docs/development-plan.md 3.1: PDFs, workbooks, insight
 * cards), stored in a private R2 bucket. Admins upload straight from the
 * browser with a presigned URL; the server records a file only after checking
 * it arrived. Downloads go through an access check, then a short-lived link.
 */
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, lt, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { courseModules, courses, lessonResources, lessons, resourceKind, videos } from "@/lib/db/schema";
import type { SessionUser } from "@/lib/auth";
import { accessFor, loadViewer } from "@/lib/playback/access";
import type { R2Storage } from "@/lib/storage/r2";

export const RESOURCE_KINDS = resourceKind.enumValues;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export const RESOURCE_POLICY = {
  maxBytes: 50 * 1024 * 1024,
  /** What can be uploaded, with the extension each type must have. */
  types: {
    "application/pdf": ["pdf"],
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx"],
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ["pptx"],
    "image/png": ["png"],
    "image/jpeg": ["jpg", "jpeg"],
  } as Record<string, string[]>,
} as const;

export const KIND_LABEL: Record<ResourceKind, string> = { pdf: "PDF", workbook: "Workbook", insight_card: "Insight card", other: "Download" };

export class ResourceError extends Error {
  constructor(
    readonly reason: "not_found" | "invalid_file" | "not_uploaded",
    message: string,
  ) {
    super(message);
    this.name = "ResourceError";
  }
}

/** Why this file can't be a lesson download, or null. */
export function fileProblem(file: { fileName: string; contentType: string; size: number }): string | null {
  const extensions = RESOURCE_POLICY.types[file.contentType];
  const extension = file.fileName.split(".").pop()?.toLowerCase() ?? "";
  if (!extensions) return "Upload a PDF, Word, Excel or PowerPoint file, or a PNG or JPEG image.";
  if (!extensions.includes(extension)) return `A ${extensions[0]!.toUpperCase()} file should end in .${extensions[0]}.`;
  if (file.size <= 0) return "That file is empty.";
  if (file.size > RESOURCE_POLICY.maxBytes) return `Files can be up to ${RESOURCE_POLICY.maxBytes / 1024 / 1024} MB.`;
  return null;
}

/** Keep the name readable but safe in a storage key and a download header. */
export function safeFileName(fileName: string): string {
  const cleaned = fileName
    .normalize("NFKC")
    .replace(/[/\\?%*:|"<>\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || "download").slice(-120);
}

/** Every lesson's files live under its own prefix, so a key can't be attached to another lesson. */
const keyPrefix = (lessonId: string) => `lessons/${lessonId}/`;

/** Step 1: a presigned URL for the admin's browser to PUT the file to. */
export async function prepareUpload(
  db: Database,
  storage: Pick<R2Storage, "presignUpload">,
  lessonId: string,
  file: { fileName: string; contentType: string; size: number },
): Promise<{ key: string; uploadUrl: string; contentType: string }> {
  const [lesson] = await db.select({ id: lessons.id }).from(lessons).where(eq(lessons.id, lessonId));
  if (!lesson) throw new ResourceError("not_found", "Lesson not found.");
  const problem = fileProblem(file);
  if (problem) throw new ResourceError("invalid_file", problem);
  const key = `${keyPrefix(lessonId)}${randomUUID()}/${safeFileName(file.fileName)}`;
  return { key, uploadUrl: await storage.presignUpload(key, file.contentType), contentType: file.contentType };
}

/** Step 2: record the file once R2 confirms it arrived (and wasn't swapped for something bigger). */
export async function addResource(
  db: Database,
  storage: Pick<R2Storage, "head">,
  input: { lessonId: string; key: string; title: string; kind: ResourceKind },
) {
  if (!input.key.startsWith(keyPrefix(input.lessonId))) throw new ResourceError("invalid_file", "That file belongs to a different lesson.");
  const stored = await storage.head(input.key);
  if (!stored) throw new ResourceError("not_uploaded", "The file didn't finish uploading. Try again.");
  if (stored.size > RESOURCE_POLICY.maxBytes) throw new ResourceError("invalid_file", "That file is over the size limit.");
  const fileName = input.key.split("/").pop()!;
  return db.transaction(async (tx) => {
    const [lesson] = await tx.select({ id: lessons.id }).from(lessons).where(eq(lessons.id, input.lessonId)).for("update");
    if (!lesson) throw new ResourceError("not_found", "Lesson not found.");
    const [{ next } = { next: 1 }] = await tx
      .select({ next: sql<number>`coalesce(max(${lessonResources.position}), 0)::int + 1` })
      .from(lessonResources)
      .where(eq(lessonResources.lessonId, input.lessonId));
    const [row] = await tx
      .insert(lessonResources)
      .values({
        lessonId: input.lessonId,
        title: input.title.trim(),
        kind: input.kind,
        r2Key: input.key,
        fileName,
        contentType: stored.contentType ?? "application/octet-stream",
        sizeBytes: stored.size,
        position: next,
      })
      .returning();
    return row!;
  });
}

export async function updateResource(db: Database, id: string, changes: { title?: string; kind?: ResourceKind }) {
  const [row] = await db
    .update(lessonResources)
    .set({ ...changes, ...(changes.title !== undefined ? { title: changes.title.trim() } : {}) })
    .where(eq(lessonResources.id, id))
    .returning();
  if (!row) throw new ResourceError("not_found", "Download not found.");
  return row;
}

/** Remove the record; returns the R2 key for the caller to delete. */
export async function deleteResource(db: Database, id: string): Promise<{ key: string }> {
  const [row] = await db.delete(lessonResources).where(eq(lessonResources.id, id)).returning({ key: lessonResources.r2Key });
  if (!row) throw new ResourceError("not_found", "Download not found.");
  return row;
}

/** Swap with the neighbor above or below. */
export async function moveResource(db: Database, id: string, direction: "up" | "down"): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(lessonResources).where(eq(lessonResources.id, id)).for("update");
    if (!row) throw new ResourceError("not_found", "Download not found.");
    const [neighbor] = await tx
      .select({ id: lessonResources.id, position: lessonResources.position })
      .from(lessonResources)
      .where(
        and(
          eq(lessonResources.lessonId, row.lessonId),
          direction === "up" ? lt(lessonResources.position, row.position) : gt(lessonResources.position, row.position),
        ),
      )
      .orderBy(direction === "up" ? desc(lessonResources.position) : asc(lessonResources.position))
      .limit(1);
    if (!neighbor) return false;
    await tx.update(lessonResources).set({ position: neighbor.position }).where(eq(lessonResources.id, row.id));
    await tx.update(lessonResources).set({ position: row.position }).where(eq(lessonResources.id, neighbor.id));
    return true;
  });
}

/** A lesson's downloads in order, for the builder and the lesson page. */
export async function lessonResourceList(db: Database, lessonId: string) {
  return db
    .select({
      id: lessonResources.id,
      title: lessonResources.title,
      kind: lessonResources.kind,
      fileName: lessonResources.fileName,
      sizeBytes: lessonResources.sizeBytes,
    })
    .from(lessonResources)
    .where(eq(lessonResources.lessonId, lessonId))
    .orderBy(asc(lessonResources.position), asc(lessonResources.createdAt));
}

/**
 * What a download needs for the access check: the resource and the video of
 * the lesson it belongs to, only when that lesson is in a published course
 * (admins may also fetch from drafts).
 */
export async function resourceForDownload(db: Database, id: string, options: { includeUnpublished?: boolean } = {}) {
  const [row] = await db
    .select({ resource: lessonResources, video: videos, published: courses.published })
    .from(lessonResources)
    .innerJoin(lessons, eq(lessonResources.lessonId, lessons.id))
    .innerJoin(courseModules, eq(lessons.moduleId, courseModules.id))
    .innerJoin(courses, eq(courseModules.courseId, courses.id))
    .leftJoin(videos, eq(lessons.videoId, videos.id))
    .where(eq(lessonResources.id, id));
  if (!row || (!row.published && !options.includeUnpublished)) return null;
  return row;
}

export type DownloadDecision =
  | { result: "not_found" }
  | { result: "denied"; signedIn: boolean }
  | { result: "allowed"; key: string; fileName: string };

/**
 * Whoever may watch the lesson may download its files: members, anyone on a
 * free preview lesson, and admins (including from draft courses).
 */
export async function downloadDecision(db: Database, id: string, sessionUser: SessionUser | null): Promise<DownloadDecision> {
  const isAdmin = sessionUser?.role === "admin";
  const found = await resourceForDownload(db, id, { includeUnpublished: isAdmin });
  if (!found) return { result: "not_found" };
  const allowed = isAdmin || (found.video !== null && (await accessFor(db, found.video, await loadViewer(db, sessionUser))).allowed);
  return allowed
    ? { result: "allowed", key: found.resource.r2Key, fileName: found.resource.fileName }
    : { result: "denied", signedIn: Boolean(sessionUser) };
}
