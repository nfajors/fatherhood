import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { createTheme, listThemesWithCounts, unthemedCounts } from "@/lib/themes/service";
import { asAdmin, readJson } from "./_shared";

/** All themes (any status) with content counts, plus how much content is unthemed. */
export async function GET() {
  return asAdmin(async () => {
    const db = getDb();
    return NextResponse.json({ themes: await listThemesWithCounts(db), unthemed: await unthemedCounts(db) });
  });
}

const createBody = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().min(10).max(600),
  bookReference: z.string().trim().max(200).nullish(),
});

/** Create an active theme. */
export async function POST(request: Request) {
  return asAdmin(async () => {
    const parsed = await readJson(request, createBody);
    if (!parsed.success) return NextResponse.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
    return NextResponse.json({ theme: await createTheme(getDb(), parsed.data) }, { status: 201 });
  });
}
