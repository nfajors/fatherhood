/**
 * Turns the classifier's answer into placements we can store. Pure and
 * unit-tested: the model may name themes that don't exist, repeat itself,
 * propose a duplicate of an existing theme or suggest a theme an admin already
 * removed, and none of that may reach the database.
 */
import type { ThemeStatus } from "@/lib/db/schema";
import { THEME_POLICY as P } from "./policy";

/** What the classifier returns (see classifier.ts for the schema sent to the model). */
export type ClassifierOutput = {
  assignments: { theme_slug: string; confidence: number; rationale: string }[];
  primary_theme_slug: string | null;
  new_theme: { name: string; description: string; rationale: string; confidence: number } | null;
};

export type CatalogTheme = {
  id: string;
  slug: string;
  name: string;
  status: ThemeStatus;
  mergedIntoId: string | null;
};

export type Placement = { themeId: string; confidence: number; rationale: string; isPrimary: boolean };

export type ThemeProposal = {
  slug: string;
  name: string;
  description: string;
  rationale: string;
  confidence: number;
  isPrimary: boolean;
};

export type Resolution = { placements: Placement[]; proposal: ThemeProposal | null };

/** URL-safe slug: "Co-Parenting & Step-Families" -> "co-parenting-and-step-families". */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

function clampConfidence(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0;
}

/** Follow merges to the theme a slug now lives in; null if it is archived without a successor. */
function assignableTheme(theme: CatalogTheme | undefined, byId: Map<string, CatalogTheme>): CatalogTheme | null {
  const seen = new Set<string>();
  let current = theme;
  while (current && current.status === "archived") {
    if (!current.mergedIntoId || seen.has(current.id)) return null;
    seen.add(current.id);
    current = byId.get(current.mergedIntoId);
  }
  return current ?? null;
}

export function resolveClassification(
  output: ClassifierOutput,
  catalog: CatalogTheme[],
  options: { blockedThemeIds?: ReadonlySet<string> } = {},
): Resolution {
  const blocked = options.blockedThemeIds ?? new Set<string>();
  const byId = new Map(catalog.map((t) => [t.id, t]));
  const bySlug = new Map(catalog.map((t) => [t.slug, t]));
  const byName = new Map(catalog.map((t) => [t.name.trim().toLowerCase(), t]));

  // Best confidence per theme; unknown, blocked and weak placements are dropped.
  const best = new Map<string, { theme: CatalogTheme; confidence: number; rationale: string; slug: string }>();
  const consider = (theme: CatalogTheme | null, confidence: number, rationale: string, slug: string) => {
    if (!theme || blocked.has(theme.id) || confidence < P.minConfidence) return;
    const existing = best.get(theme.id);
    if (!existing || confidence > existing.confidence) best.set(theme.id, { theme, confidence, rationale, slug });
  };

  for (const a of output.assignments) {
    consider(assignableTheme(bySlug.get(a.theme_slug), byId), clampConfidence(a.confidence), a.rationale.trim(), a.theme_slug);
  }

  // A "new" theme that matches an existing one by slug or name is a placement, not a proposal.
  let proposal: ThemeProposal | null = null;
  const fresh = output.new_theme;
  if (fresh && fresh.name.trim()) {
    const slug = slugify(fresh.name);
    const match = bySlug.get(slug) ?? byName.get(fresh.name.trim().toLowerCase());
    const confidence = clampConfidence(fresh.confidence);
    if (match) {
      consider(assignableTheme(match, byId), confidence, fresh.rationale.trim(), match.slug);
    } else if (slug && confidence >= P.minConfidence) {
      proposal = {
        slug,
        name: fresh.name.trim().slice(0, 80),
        description: fresh.description.trim(),
        rationale: fresh.rationale.trim(),
        confidence,
        isPrimary: false,
      };
    }
  }

  const ranked = [...best.values()].sort((a, b) => b.confidence - a.confidence || a.slug.localeCompare(b.slug));

  // Only grow the catalog when nothing existing fits strongly.
  if (proposal && (ranked[0]?.confidence ?? 0) >= P.strongFitConfidence) proposal = null;

  const kept = ranked.slice(0, proposal ? P.maxThemesPerItem - 1 : P.maxThemesPerItem);
  const requestedPrimary = output.primary_theme_slug
    ? assignableTheme(bySlug.get(output.primary_theme_slug), byId)?.id
    : undefined;
  const primaryId = kept.some((k) => k.theme.id === requestedPrimary) ? requestedPrimary : kept[0]?.theme.id;

  const placements = kept.map((k) => ({
    themeId: k.theme.id,
    confidence: k.confidence,
    rationale: k.rationale,
    isPrimary: k.theme.id === primaryId,
  }));
  if (proposal && placements.length === 0) proposal.isPrimary = true;

  return { placements, proposal };
}
