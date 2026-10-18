import { NextResponse } from "next/server";
import { z } from "zod";
import { prepareUpload } from "@/lib/courses/resources";
import { getDb } from "@/lib/db";
import { r2FromEnv } from "@/lib/storage/r2";
import { asAdmin, readJson } from "../../../../../_shared";

const body = z.object({ fileName: z.string().trim().min(1).max(200), contentType: z.string().max(200), size: z.number().int().min(0) });

/** A presigned URL for uploading a lesson file straight to R2. */
export async function POST(request: Request, { params }: { params: Promise<{ lessonId: string }> }) {
  return asAdmin(async () => {
    const { lessonId } = await params;
    const parsed = await readJson(request, body);
    if (!z.uuid().safeParse(lessonId).success || !parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    return NextResponse.json(await prepareUpload(getDb(), await r2FromEnv(), lessonId, parsed.data));
  });
}
