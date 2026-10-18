import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { setReviewHidden } from "@/lib/ratings/service";
import { asAdmin, readJson } from "../../_shared";

/** Hide or restore a written review. Its stars keep counting. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return asAdmin(async (admin) => {
    const { id } = await params;
    const parsed = await readJson(request, z.object({ hidden: z.boolean() }));
    if (!z.uuid().safeParse(id).success || !parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    await setReviewHidden(getDb(), id, parsed.data.hidden, admin.id);
    return NextResponse.json({ hidden: parsed.data.hidden });
  });
}
