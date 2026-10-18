import { NextResponse } from "next/server";
import { z } from "zod";
import { addResource, RESOURCE_KINDS } from "@/lib/courses/resources";
import { getDb } from "@/lib/db";
import { r2FromEnv } from "@/lib/storage/r2";
import { asAdmin, readJson } from "../../../../_shared";

const body = z.object({ key: z.string().min(1).max(500), title: z.string().trim().min(2).max(140), kind: z.enum(RESOURCE_KINDS) });

/** Attach an uploaded file to the lesson, once R2 confirms it's there. */
export async function POST(request: Request, { params }: { params: Promise<{ lessonId: string }> }) {
  return asAdmin(async () => {
    const { lessonId } = await params;
    const parsed = await readJson(request, body);
    if (!z.uuid().safeParse(lessonId).success || !parsed.success) {
      return NextResponse.json({ error: "invalid_request", message: parsed.error?.issues[0]?.message ?? "Invalid request" }, { status: 400 });
    }
    const resource = await addResource(getDb(), await r2FromEnv(), { lessonId, ...parsed.data });
    return NextResponse.json({ resource: { id: resource.id } }, { status: 201 });
  });
}
