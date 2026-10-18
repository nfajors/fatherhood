import { NextResponse } from "next/server";
import { z } from "zod";
import { moderateComment } from "@/lib/comments/service";
import { getDb } from "@/lib/db";
import { asAdmin, readJson } from "../../_shared";

/** Hide, restore or remove a comment; its open reports are resolved. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return asAdmin(async (admin) => {
    const { id } = await params;
    const parsed = await readJson(request, z.object({ action: z.enum(["hide", "restore", "remove"]) }));
    if (!z.uuid().safeParse(id).success || !parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    await moderateComment(getDb(), id, parsed.data.action, admin.id);
    return NextResponse.json({ done: true });
  });
}
