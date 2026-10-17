import { describe, expect, it } from "vitest";
import { resolveClassification, slugify, type CatalogTheme, type ClassifierOutput } from "./resolve";

const theme = (id: string, slug: string, name: string, extra: Partial<CatalogTheme> = {}): CatalogTheme => ({
  id,
  slug,
  name,
  status: "active",
  mergedIntoId: null,
  ...extra,
});

const catalog: CatalogTheme[] = [
  theme("t-partner", "choosing-a-partner", "Choosing a Partner"),
  theme("t-presence", "presence", "Presence"),
  theme("t-work", "work-and-family", "Work and Family"),
  theme("t-coparent", "co-parenting", "Co-Parenting and Partnership"),
  theme("t-grief", "grief-and-loss", "Grief and Loss", { status: "proposed" }),
  theme("t-old", "old-theme", "Old Theme", { status: "archived", mergedIntoId: "t-presence" }),
  theme("t-dead", "dead-theme", "Dead Theme", { status: "archived" }),
];

const output = (partial: Partial<ClassifierOutput>): ClassifierOutput => ({
  assignments: [],
  primary_theme_slug: null,
  new_theme: null,
  ...partial,
});

const a = (theme_slug: string, confidence: number, rationale = `fits ${theme_slug}`) => ({ theme_slug, confidence, rationale });

describe("slugify", () => {
  it("makes URL-safe slugs", () => {
    expect(slugify("Choosing a Partner")).toBe("choosing-a-partner");
    expect(slugify("  Co-Parenting & Step-Families! ")).toBe("co-parenting-and-step-families");
    expect(slugify("Pères et Fils")).toBe("peres-et-fils");
    expect(slugify("!!!")).toBe("");
  });

  it("caps length without a trailing dash", () => {
    const slug = slugify("word ".repeat(30));
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("resolveClassification", () => {
  it("keeps confident placements in confidence order and marks the requested primary", () => {
    const result = resolveClassification(
      output({ assignments: [a("presence", 70), a("work-and-family", 92)], primary_theme_slug: "presence" }),
      catalog,
    );
    expect(result.placements).toEqual([
      { themeId: "t-work", confidence: 92, rationale: "fits work-and-family", isPrimary: false },
      { themeId: "t-presence", confidence: 70, rationale: "fits presence", isPrimary: true },
    ]);
    expect(result.proposal).toBeNull();
  });

  it("defaults the primary to the strongest placement when the model's choice was dropped", () => {
    const result = resolveClassification(
      output({ assignments: [a("presence", 80), a("co-parenting", 40)], primary_theme_slug: "co-parenting" }),
      catalog,
    );
    expect(result.placements).toEqual([expect.objectContaining({ themeId: "t-presence", isPrimary: true })]);
  });

  it("drops unknown slugs, weak fits and blocked themes, and de-duplicates", () => {
    const result = resolveClassification(
      output({
        assignments: [a("not-a-theme", 99), a("presence", 54), a("work-and-family", 60), a("work-and-family", 85, "better"), a("choosing-a-partner", 90)],
      }),
      catalog,
      { blockedThemeIds: new Set(["t-partner"]) },
    );
    expect(result.placements).toEqual([{ themeId: "t-work", confidence: 85, rationale: "better", isPrimary: true }]);
  });

  it("caps placements at three", () => {
    const result = resolveClassification(
      output({ assignments: [a("presence", 90), a("work-and-family", 80), a("co-parenting", 70), a("choosing-a-partner", 60)] }),
      catalog,
    );
    expect(result.placements.map((p) => p.themeId)).toEqual(["t-presence", "t-work", "t-coparent"]);
  });

  it("allows proposed themes and follows merged themes to their successor", () => {
    const result = resolveClassification(output({ assignments: [a("grief-and-loss", 88), a("old-theme", 77), a("dead-theme", 95)] }), catalog);
    expect(result.placements.map((p) => [p.themeId, p.confidence])).toEqual([
      ["t-grief", 88],
      ["t-presence", 77],
    ]);
  });

  it("clamps out-of-range and non-numeric confidences", () => {
    const result = resolveClassification(output({ assignments: [a("presence", 140), a("work-and-family", Number.NaN)] }), catalog);
    expect(result.placements).toEqual([expect.objectContaining({ themeId: "t-presence", confidence: 100 })]);
  });

  describe("new theme proposals", () => {
    const newTheme = (name: string, confidence = 85) => ({ name, description: `About ${name}.`, rationale: "Central topic.", confidence });

    it("proposes a new theme when nothing fits strongly", () => {
      const result = resolveClassification(
        output({ assignments: [a("presence", 60)], new_theme: newTheme("Fathering Through Illness") }),
        catalog,
      );
      expect(result.proposal).toEqual({
        slug: "fathering-through-illness",
        name: "Fathering Through Illness",
        description: "About Fathering Through Illness.",
        rationale: "Central topic.",
        confidence: 85,
        isPrimary: false,
      });
      expect(result.placements).toEqual([expect.objectContaining({ themeId: "t-presence", isPrimary: true })]);
    });

    it("makes the proposal primary when it is the only fit", () => {
      const result = resolveClassification(output({ new_theme: newTheme("Military Fathers") }), catalog);
      expect(result.placements).toEqual([]);
      expect(result.proposal).toMatchObject({ slug: "military-fathers", isPrimary: true });
    });

    it("refuses to grow the catalog when an existing theme already fits strongly", () => {
      const result = resolveClassification(
        output({ assignments: [a("presence", 75)], new_theme: newTheme("Quality Time") }),
        catalog,
      );
      expect(result.proposal).toBeNull();
    });

    it("leaves room for the proposal within the three-theme cap", () => {
      const result = resolveClassification(
        output({ assignments: [a("presence", 70), a("work-and-family", 65), a("co-parenting", 60)], new_theme: newTheme("Night Shifts") }),
        catalog,
      );
      expect(result.placements).toHaveLength(2);
      expect(result.proposal).not.toBeNull();
    });

    it("treats a proposal that duplicates an existing theme as a placement in it", () => {
      const bySlug = resolveClassification(output({ new_theme: newTheme("Choosing a partner", 80) }), catalog);
      expect(bySlug.proposal).toBeNull();
      expect(bySlug.placements).toEqual([expect.objectContaining({ themeId: "t-partner", confidence: 80 })]);

      const byName = resolveClassification(output({ new_theme: newTheme("co-parenting and partnership", 70) }), catalog);
      expect(byName.placements).toEqual([expect.objectContaining({ themeId: "t-coparent" })]);
    });

    it("never resurrects an archived theme or a theme an admin removed", () => {
      expect(resolveClassification(output({ new_theme: newTheme("Dead Theme") }), catalog)).toEqual({ placements: [], proposal: null });
      expect(
        resolveClassification(output({ new_theme: newTheme("Choosing a Partner") }), catalog, { blockedThemeIds: new Set(["t-partner"]) }),
      ).toEqual({ placements: [], proposal: null });
    });

    it("ignores weak, empty or unsluggable proposals", () => {
      expect(resolveClassification(output({ new_theme: newTheme("Something", 40) }), catalog).proposal).toBeNull();
      expect(resolveClassification(output({ new_theme: newTheme("   ") }), catalog).proposal).toBeNull();
      expect(resolveClassification(output({ new_theme: newTheme("???") }), catalog).proposal).toBeNull();
    });
  });

  it("returns nothing for content that fits no theme", () => {
    expect(resolveClassification(output({}), catalog)).toEqual({ placements: [], proposal: null });
  });

  it("survives a merge cycle without looping", () => {
    const cyclic = [
      theme("x", "x", "X", { status: "archived", mergedIntoId: "y" }),
      theme("y", "y", "Y", { status: "archived", mergedIntoId: "x" }),
    ];
    expect(resolveClassification(output({ assignments: [a("x", 90)] }), cyclic).placements).toEqual([]);
  });
});
