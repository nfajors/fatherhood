/**
 * Run the AI theme classifier over content.
 *
 *   npm run themes:assign                 # content never classified (up to 100)
 *   npm run themes:assign -- --all        # re-classify everything (admin decisions are kept)
 *   npm run themes:assign -- --limit 500
 */
import { getDb } from "@/lib/db";
import { getThemeClassifier } from "@/lib/themes/runtime";
import { assignThemes, contentToTheme } from "@/lib/themes/service";

async function main() {
  const classifier = getThemeClassifier();
  if (!classifier) throw new Error("Set ANTHROPIC_API_KEY to run the theme classifier.");
  const args = process.argv.slice(2);
  const limitArg = args[args.indexOf("--limit") + 1];
  const limit = args.includes("--limit") ? Number(limitArg) : 100;
  if (!Number.isInteger(limit) || limit < 1) throw new Error("--limit must be a positive integer");

  const db = getDb();
  const targets = await contentToTheme(db, { all: args.includes("--all"), limit });
  console.log(`Classifying ${targets.length} items with ${classifier.model}...`);
  let failures = 0;
  for (const target of targets) {
    try {
      const result = await assignThemes(db, target, classifier);
      const placed = result.placed.map((p) => `${p.slug} (${p.confidence}${p.isPrimary ? ", primary" : ""})`).join(", ");
      console.log(`  ${target.kind} ${target.id}: ${placed || "no theme"}${result.proposedTheme ? `  [proposed: ${result.proposedTheme.name}]` : ""}`);
    } catch (error) {
      failures++;
      console.error(`  ${target.kind} ${target.id}: FAILED ${error instanceof Error ? error.message : error}`);
    }
  }
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
