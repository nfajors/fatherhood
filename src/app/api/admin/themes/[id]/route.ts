import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { adminThemeContent, updateTheme } from "@/lib/themes/service";
import { asAdmin, readJson } from "../_shared";

type Params = { params: Promise<{ id: string }> };

/** Every placement in the theme, including AI confidence and admin removals. */
export async function GET(_request: Request, { params }: Params) {
  return asAdmin(async () => {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ content: await adminThemeContent(getDb(), id) });
  });
}

const patchBody = z
  .object({
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().min(10).max(600),
    bookReference: z.string().trim().max(200).nullable(),
    status: z.enum(["proposed", "active", "archived"]),
    sortOrder: z.number().int().min(0).max(100_000),
  })
  .partial();

/** Edit a theme; status "active" approves an AI proposal, "archived" retires it. */
export async function PATCH(request: Request, { params }: Params) {
  return asAdmin(async () => {
    const { id } = await params;
    const parsed = await readJson(request, patchBody);
    if (!z.uuid().safeParse(id).success || !parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    return NextResponse.json({ theme: await updateTheme(getDb(), id, parsed.data) });
  });
}
