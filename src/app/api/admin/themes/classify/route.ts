import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { getThemeClassifier } from "@/lib/themes/runtime";
import { assignThemes, contentToTheme, type ThemeTarget } from "@/lib/themes/service";
import { asAdmin, readJson, targetSchema } from "../_shared";

const body = z.union([
  targetSchema,
  z.object({ pending: z.literal(true), limit: z.number().int().min(1).max(50).optional() }),
]);

/**
 * Run the AI classifier on one item ({kind, id}) or on content that has never
 * been themed ({pending: true}). Items run one at a time to stay inside rate limits.
 */
export async function POST(request: Request) {
  return asAdmin(async () => {
    const classifier = getThemeClassifier();
    if (!classifier) return NextResponse.json({ error: "classifier_not_configured" }, { status: 503 });
    const parsed = await readJson(request, body);
    if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

    const db = getDb();
    const targets: ThemeTarget[] =
      "pending" in parsed.data ? await contentToTheme(db, { limit: parsed.data.limit ?? 10 }) : [parsed.data];

    const results = [];
    for (const target of targets) {
      try {
        results.push({ ...target, ok: true as const, ...(await assignThemes(db, target, classifier)) });
      } catch (error) {
        results.push({ ...target, ok: false as const, error: error instanceof Error ? error.message : "failed" });
      }
    }
    return NextResponse.json({ results });
  });
}
