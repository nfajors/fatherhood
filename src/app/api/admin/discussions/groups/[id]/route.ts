import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { updateGroup } from "@/lib/discussions/service";
import { asAdmin, readJson } from "../../../_shared";

const body = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().min(5).max(300).optional(),
  status: z.enum(["active", "archived"]).optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return asAdmin(async () => {
    const id = z.uuid().safeParse((await params).id);
    const parsed = await readJson(request, body);
    if (!id.success || !parsed.success) return NextResponse.json({ error: "invalid", message: parsed.error?.issues[0]?.message }, { status: 400 });
    await updateGroup(getDb(), id.data, parsed.data);
    return NextResponse.json({ saved: true });
  });
}
