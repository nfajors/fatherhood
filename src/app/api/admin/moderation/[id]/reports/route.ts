import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { resolveReports } from "@/lib/moderation/service";
import { asAdmin, readJson } from "../../../_shared";

/** Close a video's open reports as actioned (they were right) or dismissed. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return asAdmin(async (admin) => {
    const { id } = await params;
    const parsed = await readJson(request, z.object({ outcome: z.enum(["actioned", "dismissed"]) }));
    if (!z.uuid().safeParse(id).success || !parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    const resolved = await resolveReports(getDb(), { videoId: id, reviewerId: admin.id, outcome: parsed.data.outcome });
    return NextResponse.json({ resolved });
  });
}
