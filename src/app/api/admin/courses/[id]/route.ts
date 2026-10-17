import { after, NextResponse } from "next/server";
import { z } from "zod";
import { CATEGORIES } from "@/lib/config";
import { setPublished, updateCourse } from "@/lib/courses/admin";
import { getDb } from "@/lib/db";
import { themeInBackground } from "@/lib/themes/runtime";
import { asAdmin, readJson } from "../../_shared";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable();

const body = z
  .object({
    title: z.string().trim().min(3).max(140),
    slug: z.string().trim().min(1).max(60),
    subtitle: optionalText(200),
    description: optionalText(5000),
    category: z.enum(CATEGORIES).nullable(),
    coverImageUrl: z.url().max(500).nullable().or(z.literal("").transform(() => null)),
    bookChapter: optionalText(200),
    instructorId: z.string().min(1).nullable(),
    sortOrder: z.number().int().min(0).max(100_000),
    published: z.boolean(),
  })
  .partial();

/** Edit course details, or publish/unpublish. Publishing (re)classifies the course into themes. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return asAdmin(async () => {
    const { id } = await params;
    const parsed = await readJson(request, body);
    if (!z.uuid().safeParse(id).success || !parsed.success) {
      return NextResponse.json({ error: "invalid_request", message: parsed.error?.issues[0]?.message ?? "Invalid request" }, { status: 400 });
    }
    const db = getDb();
    const { published, ...details } = parsed.data;
    let course = Object.keys(details).length ? await updateCourse(db, id, details) : null;
    if (published !== undefined) {
      course = await setPublished(db, id, published);
      if (published) after(() => themeInBackground({ kind: "course", id }));
    }
    return NextResponse.json({ course });
  });
}
