import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { mergeThemes } from "@/lib/themes/service";
import { asAdmin, readJson } from "../../_shared";

/** Merge this theme into another: its content moves and it is archived. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return asAdmin(async () => {
    const { id } = await params;
    const parsed = await readJson(request, z.object({ intoThemeId: z.uuid() }));
    if (!z.uuid().safeParse(id).success || !parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    return NextResponse.json(await mergeThemes(getDb(), id, parsed.data.intoThemeId));
  });
}
