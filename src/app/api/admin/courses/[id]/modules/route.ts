import { NextResponse } from "next/server";
import { z } from "zod";
import { addModule } from "@/lib/courses/admin";
import { getDb } from "@/lib/db";
import { asAdmin, readJson } from "../../../_shared";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return asAdmin(async () => {
    const { id } = await params;
    const parsed = await readJson(request, z.object({ title: z.string().trim().min(1).max(140) }));
    if (!z.uuid().safeParse(id).success || !parsed.success) return NextResponse.json({ error: "invalid_request", message: "Give the module a title." }, { status: 400 });
    return NextResponse.json({ module: await addModule(getDb(), id, parsed.data.title) }, { status: 201 });
  });
}
