import { NextResponse } from "next/server";
import { z } from "zod";
import { addItem } from "@/lib/collections/service";
import { getDb } from "@/lib/db";
import { asAdmin, readJson } from "../../../_shared";

const body = z.object({ courseId: z.uuid().optional(), videoId: z.uuid().optional(), note: z.string().trim().max(500).nullable().optional() });

/** Add a course or a Community video to a collection. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return asAdmin(async () => {
    const { id } = await params;
    const parsed = await readJson(request, body);
    if (!z.uuid().safeParse(id).success || !parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    const item = await addItem(getDb(), id, { courseId: parsed.data.courseId, videoId: parsed.data.videoId, note: parsed.data.note });
    return NextResponse.json({ item: { id: item.id } }, { status: 201 });
  });
}
