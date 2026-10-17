/**
 * Theme service against a real Postgres, with a scripted classifier. Runs only
 * when TEST_DATABASE_URL points at a disposable database (tables are truncated).
 */
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import type { ContentForTheming, ThemeClassifier, ThemeForPrompt } from "./classifier";
import type { ClassifierOutput } from "./resolve";
import { SEED_THEMES, SUPERSEDED_SEED_THEMES } from "./seed";
import {
  adminThemeContent,
  assignThemes,
  contentToTheme,
  createTheme,
  listThemesWithCounts,
  mergeThemes,
  placeContent,
  publicThemeContent,
  removeContent,
  seedThemes,
  ThemeServiceError,
  unthemedCounts,
  updateTheme,
} from "./service";

const url = process.env.TEST_DATABASE_URL;

/** Returns queued answers and records what it was asked. */
class ScriptedClassifier implements ThemeClassifier {
  readonly model = "scripted";
  calls: { content: ContentForTheming; themes: ThemeForPrompt[] }[] = [];
  constructor(private answers: ClassifierOutput[]) {}
  async classify(content: ContentForTheming, themes: ThemeForPrompt[]) {
    this.calls.push({ content, themes });
    const next = this.answers.shift();
    if (!next) throw new Error("no scripted answer left");
    return next;
  }
}

const answer = (assignments: [string, number][], extra: Partial<ClassifierOutput> = {}): ClassifierOutput => ({
  assignments: assignments.map(([theme_slug, confidence]) => ({ theme_slug, confidence, rationale: `fits ${theme_slug}` })),
  primary_theme_slug: assignments[0]?.[0] ?? null,
  new_theme: null,
  ...extra,
});

describe.skipIf(!url)("theme service (Postgres)", () => {
  let client: postgres.Sql;
  let db: Database;
  const VIDEO = "aaaaaaaa-0000-4000-8000-000000000001";
  const VIDEO2 = "aaaaaaaa-0000-4000-8000-000000000002";
  const COURSE = "cccccccc-0000-4000-8000-000000000001";

  beforeAll(async () => {
    client = postgres(url!, { max: 1, onnotice: () => {} });
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: "drizzle" });
  });

  afterAll(async () => {
    await client?.end();
  });

  beforeEach(async () => {
    await db.execute(sql`truncate theme_assignments, themes, lessons, course_modules, courses, videos, "user" cascade`);
    await db.insert(schema.user).values({ id: "fellow", name: "Fellow", email: "fellow@test.dev", role: "creator" });
    await db.insert(schema.videos).values([
      { id: VIDEO, type: "community", status: "approved", creatorId: "fellow", title: "Night shift dad", description: "Working nights and still showing up.", tags: ["work"], requireSignedUrls: false, publishedAt: new Date() },
      { id: VIDEO2, type: "community", status: "pending_review", creatorId: "fellow", title: "Draft", requireSignedUrls: false },
    ]);
    await db.insert(schema.courses).values({ id: COURSE, slug: "why-fathers-matter", title: "Why Fathers Matter", subtitle: "The evidence", published: true });
    const [mod] = await db.insert(schema.courseModules).values({ courseId: COURSE, title: "The research", position: 1 }).returning();
    await db.insert(schema.lessons).values({ moduleId: mod!.id, title: "Outcomes for children", summary: "What studies show", position: 1 });
    await seedThemes(db);
  });

  const themeId = async (slug: string) => (await db.query.themes.findFirst({ where: eq(schema.themes.slug, slug) }))!.id;
  const placementsFor = (videoId: string) =>
    db
      .select({ slug: schema.themes.slug, source: schema.themeAssignments.source, status: schema.themeAssignments.status, confidence: schema.themeAssignments.confidence, isPrimary: schema.themeAssignments.isPrimary })
      .from(schema.themeAssignments)
      .innerJoin(schema.themes, eq(schema.themes.id, schema.themeAssignments.themeId))
      .where(eq(schema.themeAssignments.videoId, videoId))
      .orderBy(schema.themes.slug);

  it("seeds the starting themes once and never overwrites admin edits", async () => {
    expect(await db.$count(schema.themes)).toBe(SEED_THEMES.length);
    await updateTheme(db, await themeId("presence"), { name: "Being Present" });
    expect(await seedThemes(db)).toEqual({ added: [], upgraded: [] });
    expect((await db.query.themes.findFirst({ where: eq(schema.themes.slug, "presence") }))!.name).toBe("Being Present");
  });

  it("upgrades unedited themes from the earlier seed in place, keeping their placements", async () => {
    await db.execute(sql`truncate themes cascade`);
    const oldRows = await db
      .insert(schema.themes)
      .values(SUPERSEDED_SEED_THEMES.map((t) => ({ slug: t.slug, name: t.name, description: t.description, status: "active" as const, origin: "book" as const })))
      .returning();
    const oldId = (slug: string) => oldRows.find((r) => r.slug === slug)!.id;
    // An admin edited one theme; seeding must leave it alone.
    await updateTheme(db, oldId("presence"), { description: "Our own description of presence." });
    await placeContent(db, oldId("father-absence-and-repair"), { kind: "video", id: VIDEO });

    const result = await seedThemes(db);

    expect(result.upgraded).toContain("breaking-the-cycle");
    expect(result.upgraded).not.toContain("presence");
    expect(result.added.sort()).toEqual(["grow-the-tree-you-have", "the-biology-of-fatherhood", "the-future-of-fatherhood"]);
    expect(await db.$count(schema.themes)).toBe(SEED_THEMES.length);

    const renamed = await db.query.themes.findFirst({ where: eq(schema.themes.id, oldId("father-absence-and-repair")) });
    expect(renamed).toMatchObject({ slug: "breaking-the-cycle", name: "Breaking the Cycle" });
    expect(renamed!.bookReference).toContain("Ch. 2");
    expect(await placementsFor(VIDEO)).toEqual([expect.objectContaining({ slug: "breaking-the-cycle", source: "admin" })]);
    expect((await db.query.themes.findFirst({ where: eq(schema.themes.id, oldId("presence")) }))!.description).toBe(
      "Our own description of presence.",
    );

    // Running it again changes nothing.
    expect(await seedThemes(db)).toEqual({ added: [], upgraded: [] });
  });

  it("does not rename onto a slug that is already taken", async () => {
    await db.execute(sql`truncate themes cascade`);
    const old = SUPERSEDED_SEED_THEMES.find((t) => t.slug === "co-parenting")!;
    await db.insert(schema.themes).values([
      { slug: old.slug, name: old.name, description: old.description, status: "active", origin: "book" },
      { slug: "partnership-and-co-parenting", name: "Partnership", description: "Created by an admin earlier.", status: "active", origin: "admin" },
    ]);
    const result = await seedThemes(db);
    expect(result.upgraded).not.toContain("partnership-and-co-parenting");
    expect(await db.$count(schema.themes, eq(schema.themes.slug, "co-parenting"))).toBe(1);
  });

  it("places a video, sends only active and proposed themes, and records when it ran", async () => {
    await updateTheme(db, await themeId("fathers-in-history"), { status: "archived" });
    const classifier = new ScriptedClassifier([answer([["work-and-family", 91], ["presence", 72]])]);

    const result = await assignThemes(db, { kind: "video", id: VIDEO }, classifier);

    expect(result.placed.map((p) => [p.slug, p.confidence, p.isPrimary])).toEqual([
      ["work-and-family", 91, true],
      ["presence", 72, false],
    ]);
    expect(classifier.calls[0]!.content).toMatchObject({ kind: "video", title: "Night shift dad", tags: ["work"] });
    expect(classifier.calls[0]!.themes.map((t) => t.slug)).not.toContain("fathers-in-history");
    expect(classifier.calls[0]!.themes).toHaveLength(SEED_THEMES.length - 1);
    expect((await db.query.videos.findFirst({ where: eq(schema.videos.id, VIDEO) }))!.themedAt).toBeInstanceOf(Date);
  });

  it("creates a proposed theme and reuses it for the next video instead of duplicating it", async () => {
    const proposal = { name: "Night Shift Fathers", description: "Fathers working nights.", rationale: "Central topic.", confidence: 88 };
    const classifier = new ScriptedClassifier([
      answer([["work-and-family", 65]], { new_theme: proposal }),
      answer([], { new_theme: { ...proposal, name: "night shift fathers" } }),
    ]);

    const first = await assignThemes(db, { kind: "video", id: VIDEO }, classifier);
    expect(first.proposedTheme).toMatchObject({ slug: "night-shift-fathers", name: "Night Shift Fathers" });
    const created = await db.query.themes.findFirst({ where: eq(schema.themes.slug, "night-shift-fathers") });
    expect(created).toMatchObject({ status: "proposed", origin: "ai", proposalRationale: "Central topic." });

    const second = await assignThemes(db, { kind: "video", id: VIDEO2 }, classifier);
    expect(second.proposedTheme).toBeNull();
    expect(second.placed).toEqual([expect.objectContaining({ slug: "night-shift-fathers", isPrimary: true })]);
    expect(await db.$count(schema.themes, eq(schema.themes.slug, "night-shift-fathers"))).toBe(1);
    // The classifier sees the proposal on the second run.
    expect(classifier.calls[1]!.themes).toContainEqual(expect.objectContaining({ slug: "night-shift-fathers", status: "proposed" }));
  });

  it("replaces earlier AI placements but keeps admin placements and removals", async () => {
    const target = { kind: "video" as const, id: VIDEO };
    await assignThemes(db, target, new ScriptedClassifier([answer([["presence", 80], ["work-and-family", 70]])]));
    await removeContent(db, await themeId("presence"), target);
    await placeContent(db, await themeId("partnership-and-co-parenting"), target, true);

    // The AI tries again with presence (removed) and co-parenting (admin's) and a new fit.
    await assignThemes(db, target, new ScriptedClassifier([answer([["presence", 95], ["partnership-and-co-parenting", 90], ["values-and-character", 60]])]));

    expect(await placementsFor(VIDEO)).toEqual([
      { slug: "partnership-and-co-parenting", source: "admin", status: "active", confidence: null, isPrimary: true },
      { slug: "presence", source: "admin", status: "rejected", confidence: 80, isPrimary: false },
      { slug: "values-and-character", source: "ai", status: "active", confidence: 60, isPrimary: false },
    ]);
  });

  it("lets an admin put back a removed placement", async () => {
    const target = { kind: "video" as const, id: VIDEO };
    const presence = await themeId("presence");
    await removeContent(db, presence, target);
    await placeContent(db, presence, target);
    expect(await placementsFor(VIDEO)).toEqual([expect.objectContaining({ slug: "presence", source: "admin", status: "active" })]);
  });

  it("merges a theme: content moves, the source is archived, and the AI follows the merge", async () => {
    const target = { kind: "video" as const, id: VIDEO };
    const absence = await themeId("breaking-the-cycle");
    const presence = await themeId("presence");
    await assignThemes(db, target, new ScriptedClassifier([answer([["breaking-the-cycle", 85]])]));
    await placeContent(db, presence, { kind: "video", id: VIDEO2 });
    await placeContent(db, absence, { kind: "video", id: VIDEO2 });

    expect(await mergeThemes(db, absence, presence)).toEqual({ moved: 1 });
    expect(await db.query.themes.findFirst({ where: eq(schema.themes.id, absence) })).toMatchObject({ status: "archived", mergedIntoId: presence });
    expect(await placementsFor(VIDEO)).toEqual([expect.objectContaining({ slug: "presence", source: "ai", confidence: 85 })]);
    expect(await placementsFor(VIDEO2)).toEqual([expect.objectContaining({ slug: "presence", source: "admin" })]);

    // A stale answer naming the merged theme lands in its successor.
    await assignThemes(db, target, new ScriptedClassifier([answer([["breaking-the-cycle", 77]])]));
    expect(await placementsFor(VIDEO)).toEqual([expect.objectContaining({ slug: "presence", confidence: 77 })]);

    await expect(mergeThemes(db, presence, presence)).rejects.toThrowError(ThemeServiceError);
    await expect(mergeThemes(db, presence, absence)).rejects.toThrowError(/archived/);
  });

  it("classifies courses from their outline", async () => {
    const classifier = new ScriptedClassifier([answer([["why-fathers-matter", 96]])]);
    await assignThemes(db, { kind: "course", id: COURSE }, classifier);
    expect(classifier.calls[0]!.content).toEqual({
      kind: "course",
      title: "Why Fathers Matter",
      description: "The evidence",
      category: null,
      body: "The research / Outcomes for children: What studies show",
    });
    const public_ = await publicThemeContent(db, await themeId("why-fathers-matter"));
    expect(public_.courses.map((c) => c.slug)).toEqual(["why-fathers-matter"]);
  });

  it("shows only approved videos publicly, and everything to admins", async () => {
    const presence = await themeId("presence");
    await placeContent(db, presence, { kind: "video", id: VIDEO });
    await placeContent(db, presence, { kind: "video", id: VIDEO2 });
    expect((await publicThemeContent(db, presence)).videos.map((v) => v.id)).toEqual([VIDEO]);
    expect((await adminThemeContent(db, presence)).map((p) => p.title).sort()).toEqual(["Draft", "Night shift dad"]);
    const listed = await listThemesWithCounts(db);
    expect(listed.find((t) => t.slug === "presence")?.contentCount).toBe(2);
  });

  it("tracks content that still needs theming", async () => {
    expect(await unthemedCounts(db)).toEqual({ neverRun: 3, noTheme: 0 });
    expect(await contentToTheme(db)).toHaveLength(3);

    await assignThemes(db, { kind: "video", id: VIDEO }, new ScriptedClassifier([answer([])]));
    expect(await unthemedCounts(db)).toEqual({ neverRun: 2, noTheme: 1 });
    expect((await contentToTheme(db)).map((t) => t.id)).not.toContain(VIDEO);
    expect(await contentToTheme(db, { all: true })).toHaveLength(3);
    expect(await contentToTheme(db, { limit: 1 })).toHaveLength(1);
  });

  it("creates admin themes and rejects duplicates", async () => {
    const created = await createTheme(db, { name: "Faith and Fatherhood", description: "Religious faith in family life." });
    expect(created).toMatchObject({ slug: "faith-and-fatherhood", status: "active", origin: "admin", sortOrder: (SEED_THEMES.length + 1) * 10 });
    await expect(createTheme(db, { name: "Presence", description: "Duplicate of a seed theme." })).rejects.toThrowError(/already exists/);
    await expect(createTheme(db, { name: "!!", description: "No letters." })).rejects.toThrowError(ThemeServiceError);
  });

  it("restoring an archived theme clears its merge pointer", async () => {
    const absence = await themeId("breaking-the-cycle");
    await mergeThemes(db, absence, await themeId("presence"));
    await updateTheme(db, absence, { status: "active" });
    expect(await db.query.themes.findFirst({ where: and(eq(schema.themes.id, absence)) })).toMatchObject({ status: "active", mergedIntoId: null });
  });
});
