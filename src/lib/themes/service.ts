/**
 * Theme operations against the database: run the classifier on a video or
 * course, seed the starting themes, and the admin actions (approve, edit,
 * merge, archive, place and remove).
 */
import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { courseModules, courses, lessons, themeAssignments, themes, videos, type ThemeStatus } from "@/lib/db/schema";
import type { ContentForTheming, ThemeClassifier } from "./classifier";
import { resolveClassification, slugify, type CatalogTheme } from "./resolve";
import { SEED_THEMES, SUPERSEDED_SEED_THEMES } from "./seed";

export type ThemeTarget = { kind: "video"; id: string } | { kind: "course"; id: string };

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Database | Transaction;

export class ThemeServiceError extends Error {}

/** New themes (admin-created or AI-proposed) sort after existing ones. */
const nextSortOrder = sql<number>`(select coalesce(max(sort_order), 0) + 10 from themes)`;

function targetColumn(target: ThemeTarget) {
  return target.kind === "video" ? themeAssignments.videoId : themeAssignments.courseId;
}

function targetValues(target: ThemeTarget) {
  return target.kind === "video" ? { videoId: target.id } : { courseId: target.id };
}

export type SeedResult = { added: string[]; upgraded: string[] };

/**
 * Bring the starting themes up to date: upgrade rows that still match an earlier
 * seed version exactly (renaming in place keeps their placements), then insert
 * any seed theme that doesn't exist. Themes an admin has edited are left alone.
 */
export async function seedThemes(db: Database): Promise<SeedResult> {
  return db.transaction(async (tx) => {
    const order = new Map(SEED_THEMES.map((t, i) => [t.slug, (i + 1) * 10]));
    const bySlug = new Map(SEED_THEMES.map((t) => [t.slug, t]));
    const upgraded: string[] = [];

    for (const old of SUPERSEDED_SEED_THEMES) {
      const next = bySlug.get(old.replacedBy);
      if (!next) continue;
      if (old.slug !== next.slug) {
        const [taken] = await tx.select({ id: themes.id }).from(themes).where(eq(themes.slug, next.slug));
        if (taken) continue;
      }
      const updated = await tx
        .update(themes)
        .set({
          slug: next.slug,
          name: next.name,
          description: next.description,
          bookReference: next.bookReference ?? null,
          sortOrder: order.get(next.slug) ?? 0,
        })
        .where(
          and(
            eq(themes.slug, old.slug),
            eq(themes.name, old.name),
            eq(themes.description, old.description),
            eq(themes.origin, "book"),
          ),
        )
        .returning({ slug: themes.slug });
      upgraded.push(...updated.map((r) => r.slug));
    }

    const inserted = await tx
      .insert(themes)
      .values(
        SEED_THEMES.map((t) => ({
          slug: t.slug,
          name: t.name,
          description: t.description,
          bookReference: t.bookReference ?? null,
          status: "active" as const,
          origin: "book" as const,
          sortOrder: order.get(t.slug) ?? 0,
        })),
      )
      .onConflictDoNothing({ target: themes.slug })
      .returning({ slug: themes.slug });

    return { added: inserted.map((r) => r.slug), upgraded };
  });
}

/** Load the classifier input for a video or course; null if it doesn't exist. */
export async function loadContent(db: Executor, target: ThemeTarget): Promise<ContentForTheming | null> {
  if (target.kind === "video") {
    const [v] = await db.select().from(videos).where(eq(videos.id, target.id));
    if (!v) return null;
    return { kind: "video", title: v.title, description: v.description, category: v.category, tags: v.tags, body: v.transcript };
  }
  const [c] = await db.select().from(courses).where(eq(courses.id, target.id));
  if (!c) return null;
  const outline = await db
    .select({ module: courseModules.title, lesson: lessons.title, summary: lessons.summary })
    .from(lessons)
    .innerJoin(courseModules, eq(lessons.moduleId, courseModules.id))
    .where(eq(courseModules.courseId, c.id))
    .orderBy(asc(courseModules.position), asc(lessons.position));
  return {
    kind: "course",
    title: c.title,
    description: [c.subtitle, c.description, c.bookChapter ? `Book chapter: ${c.bookChapter}` : null].filter(Boolean).join("\n"),
    category: c.category,
    body: outline.map((o) => `${o.module} / ${o.lesson}${o.summary ? `: ${o.summary}` : ""}`).join("\n") || null,
  };
}

export type ThemingResult = {
  placed: { themeId: string; slug: string; confidence: number; isPrimary: boolean }[];
  proposedTheme: { id: string; slug: string; name: string } | null;
};

/**
 * Classify one video or course and store its placements. Replaces earlier AI
 * placements; admin placements and admin removals are kept and respected.
 */
export async function assignThemes(db: Database, target: ThemeTarget, classifier: ThemeClassifier): Promise<ThemingResult> {
  const content = await loadContent(db, target);
  if (!content) throw new ThemeServiceError(`${target.kind} ${target.id} not found`);

  const catalog: CatalogTheme[] = await db
    .select({ id: themes.id, slug: themes.slug, name: themes.name, status: themes.status, mergedIntoId: themes.mergedIntoId })
    .from(themes);
  const existing = await db
    .select({
      themeId: themeAssignments.themeId,
      source: themeAssignments.source,
      status: themeAssignments.status,
      isPrimary: themeAssignments.isPrimary,
    })
    .from(themeAssignments)
    .where(eq(targetColumn(target), target.id));
  const adminChosePrimary = existing.some((e) => e.source === "admin" && e.status === "active" && e.isPrimary);
  // Admin decisions win: never re-add a removed theme or duplicate an admin placement.
  const blocked = new Set(existing.filter((e) => e.status === "rejected" || e.source === "admin").map((e) => e.themeId));

  const promptThemes = await db
    .select({ slug: themes.slug, name: themes.name, description: themes.description, status: themes.status })
    .from(themes)
    .where(inArray(themes.status, ["active", "proposed"]));
  const output = await classifier.classify(
    content,
    promptThemes.map((t) => ({ ...t, status: t.status as "active" | "proposed" })),
  );
  const { placements, proposal } = resolveClassification(output, catalog, { blockedThemeIds: blocked });

  return db.transaction(async (tx) => {
    let proposedTheme: ThemingResult["proposedTheme"] = null;
    const rows = placements.map((p) => (adminChosePrimary ? { ...p, isPrimary: false } : p));

    if (proposal) {
      await tx
        .insert(themes)
        .values({
          slug: proposal.slug,
          name: proposal.name,
          description: proposal.description,
          proposalRationale: proposal.rationale,
          status: "proposed",
          origin: "ai",
          sortOrder: nextSortOrder,
        })
        .onConflictDoNothing({ target: themes.slug });
      // Another item may have proposed the same theme at the same moment; use whichever row exists.
      const [row] = await tx.select().from(themes).where(eq(themes.slug, proposal.slug));
      if (row && row.status !== "archived" && !blocked.has(row.id)) {
        proposedTheme = { id: row.id, slug: row.slug, name: row.name };
        rows.push({
          themeId: row.id,
          confidence: proposal.confidence,
          rationale: proposal.rationale,
          isPrimary: proposal.isPrimary && !adminChosePrimary,
        });
      }
    }

    await tx
      .delete(themeAssignments)
      .where(and(eq(targetColumn(target), target.id), eq(themeAssignments.source, "ai"), eq(themeAssignments.status, "active")));
    if (rows.length > 0) {
      await tx
        .insert(themeAssignments)
        .values(rows.map((r) => ({ ...targetValues(target), ...r, source: "ai" as const })))
        .onConflictDoNothing();
    }
    const now = new Date();
    if (target.kind === "video") await tx.update(videos).set({ themedAt: now }).where(eq(videos.id, target.id));
    else await tx.update(courses).set({ themedAt: now }).where(eq(courses.id, target.id));

    const slugs = new Map(catalog.map((t) => [t.id, t.slug]));
    if (proposedTheme) slugs.set(proposedTheme.id, proposedTheme.slug);
    return {
      placed: rows.map((r) => ({ themeId: r.themeId, slug: slugs.get(r.themeId) ?? "", confidence: r.confidence, isPrimary: r.isPrimary })),
      proposedTheme,
    };
  });
}

/** Videos and courses the classifier has not run on yet (or all of them). */
export async function contentToTheme(db: Database, options: { all?: boolean; limit?: number } = {}): Promise<ThemeTarget[]> {
  const limit = options.limit ?? 100;
  const vids = await db
    .select({ id: videos.id })
    .from(videos)
    .where(and(ne(videos.status, "failed"), options.all ? undefined : isNull(videos.themedAt)))
    .orderBy(asc(videos.createdAt))
    .limit(limit);
  const crs = await db
    .select({ id: courses.id })
    .from(courses)
    .where(options.all ? undefined : isNull(courses.themedAt))
    .orderBy(asc(courses.createdAt))
    .limit(Math.max(0, limit - vids.length));
  return [...vids.map((v) => ({ kind: "video" as const, id: v.id })), ...crs.map((c) => ({ kind: "course" as const, id: c.id }))];
}

// ---------------------------------------------------------------------------
// Admin actions
// ---------------------------------------------------------------------------

export async function createTheme(db: Database, input: { name: string; description: string; bookReference?: string | null }) {
  const slug = slugify(input.name);
  if (!slug) throw new ThemeServiceError("Theme name must contain letters or numbers.");
  const [row] = await db
    .insert(themes)
    .values({ slug, name: input.name.trim(), description: input.description.trim(), bookReference: input.bookReference ?? null, status: "active", origin: "admin", sortOrder: nextSortOrder })
    .onConflictDoNothing({ target: themes.slug })
    .returning();
  if (!row) throw new ThemeServiceError(`A theme with the slug "${slug}" already exists.`);
  return row;
}

/** Edit a theme or change its status (approve a proposal, archive, restore). */
export async function updateTheme(
  db: Database,
  id: string,
  changes: { name?: string; description?: string; bookReference?: string | null; status?: ThemeStatus; sortOrder?: number },
) {
  const [row] = await db
    .update(themes)
    .set({
      ...(changes.name !== undefined ? { name: changes.name.trim() } : {}),
      ...(changes.description !== undefined ? { description: changes.description.trim() } : {}),
      ...(changes.bookReference !== undefined ? { bookReference: changes.bookReference } : {}),
      ...(changes.sortOrder !== undefined ? { sortOrder: changes.sortOrder } : {}),
      ...(changes.status !== undefined ? { status: changes.status, ...(changes.status !== "archived" ? { mergedIntoId: null } : {}) } : {}),
    })
    .where(eq(themes.id, id))
    .returning();
  if (!row) throw new ThemeServiceError("Theme not found.");
  return row;
}

/**
 * Merge `sourceId` into `targetId`: placements move to the target (keeping the
 * target's own where both exist) and the source is archived with a pointer to
 * the target, so the classifier follows it there.
 */
export async function mergeThemes(db: Database, sourceId: string, targetId: string): Promise<{ moved: number }> {
  if (sourceId === targetId) throw new ThemeServiceError("Cannot merge a theme into itself.");
  return db.transaction(async (tx) => {
    const found = await tx.select().from(themes).where(inArray(themes.id, [sourceId, targetId]));
    const target = found.find((t) => t.id === targetId);
    if (found.length !== 2 || !target) throw new ThemeServiceError("Theme not found.");
    if (target.status === "archived") throw new ThemeServiceError("Cannot merge into an archived theme.");

    const moved = await tx.execute(sql`
      insert into theme_assignments (theme_id, video_id, course_id, source, status, confidence, rationale, is_primary)
      select ${targetId}::uuid, video_id, course_id, source, status, confidence, rationale, is_primary
      from theme_assignments where theme_id = ${sourceId}::uuid
      on conflict do nothing`);
    await tx.delete(themeAssignments).where(eq(themeAssignments.themeId, sourceId));
    await tx.update(themes).set({ status: "archived", mergedIntoId: targetId }).where(eq(themes.id, sourceId));
    return { moved: moved.count ?? 0 };
  });
}

/** An admin places content in a theme (overriding any earlier removal). */
export async function placeContent(db: Database, themeId: string, target: ThemeTarget, isPrimary = false): Promise<void> {
  await db.transaction(async (tx) => {
    if (isPrimary) {
      await tx.update(themeAssignments).set({ isPrimary: false }).where(eq(targetColumn(target), target.id));
    }
    await tx
      .insert(themeAssignments)
      .values({ themeId, ...targetValues(target), source: "admin", status: "active", isPrimary })
      .onConflictDoUpdate({
        target: target.kind === "video" ? [themeAssignments.themeId, themeAssignments.videoId] : [themeAssignments.themeId, themeAssignments.courseId],
        set: { source: "admin", status: "active", isPrimary, confidence: null, rationale: null },
      });
  });
}

/** An admin removes content from a theme; the classifier will not put it back. */
export async function removeContent(db: Database, themeId: string, target: ThemeTarget): Promise<void> {
  await db
    .insert(themeAssignments)
    .values({ themeId, ...targetValues(target), source: "admin", status: "rejected" })
    .onConflictDoUpdate({
      target: target.kind === "video" ? [themeAssignments.themeId, themeAssignments.videoId] : [themeAssignments.themeId, themeAssignments.courseId],
      set: { source: "admin", status: "rejected", isPrimary: false },
    });
}

/** Themes with how much content each holds (all statuses, for the admin tool). */
export async function listThemesWithCounts(db: Database) {
  return db
    .select({
      id: themes.id,
      slug: themes.slug,
      name: themes.name,
      description: themes.description,
      status: themes.status,
      origin: themes.origin,
      bookReference: themes.bookReference,
      proposalRationale: themes.proposalRationale,
      mergedIntoId: themes.mergedIntoId,
      sortOrder: themes.sortOrder,
      // Qualified on purpose: inside the subquery an unqualified "id" would mean the assignment's id.
      contentCount: sql<number>`(select count(*)::int from theme_assignments a where a.theme_id = "themes"."id" and a.status = 'active')`,
    })
    .from(themes)
    .orderBy(asc(themes.sortOrder), asc(themes.name));
}

/** Approved videos and published courses in an active theme, for public pages. */
export async function publicThemeContent(db: Database, themeId: string) {
  const vids = await db
    .select({ id: videos.id, title: videos.title, type: videos.type, thumbnailUrl: videos.thumbnailUrl, durationSeconds: videos.durationSeconds, isPrimary: themeAssignments.isPrimary })
    .from(themeAssignments)
    .innerJoin(videos, eq(themeAssignments.videoId, videos.id))
    .where(and(eq(themeAssignments.themeId, themeId), eq(themeAssignments.status, "active"), eq(videos.status, "approved")))
    .orderBy(sql`${themeAssignments.isPrimary} desc`, sql`${videos.publishedAt} desc nulls last`);
  const crs = await db
    .select({ id: courses.id, slug: courses.slug, title: courses.title, subtitle: courses.subtitle })
    .from(themeAssignments)
    .innerJoin(courses, eq(themeAssignments.courseId, courses.id))
    .where(and(eq(themeAssignments.themeId, themeId), eq(themeAssignments.status, "active"), eq(courses.published, true)))
    .orderBy(asc(courses.sortOrder));
  return { videos: vids, courses: crs };
}

/** Every placement in a theme with its source and confidence, for the admin tool. */
export async function adminThemeContent(db: Database, themeId: string) {
  return db
    .select({
      assignmentId: themeAssignments.id,
      videoId: themeAssignments.videoId,
      courseId: themeAssignments.courseId,
      title: sql<string>`coalesce(${videos.title}, ${courses.title})`,
      contentStatus: sql<string>`coalesce(${videos.status}::text, case when ${courses.published} then 'published' else 'draft' end)`,
      source: themeAssignments.source,
      status: themeAssignments.status,
      confidence: themeAssignments.confidence,
      rationale: themeAssignments.rationale,
      isPrimary: themeAssignments.isPrimary,
    })
    .from(themeAssignments)
    .leftJoin(videos, eq(themeAssignments.videoId, videos.id))
    .leftJoin(courses, eq(themeAssignments.courseId, courses.id))
    .where(eq(themeAssignments.themeId, themeId))
    .orderBy(sql`${themeAssignments.status} asc`, sql`${themeAssignments.confidence} desc nulls first`);
}

/** Count of content the classifier hasn't run on, or that ended up with no theme. */
export async function unthemedCounts(db: Database) {
  const [row] = await db.execute<{ never_run: number; no_theme: number }>(sql`
    select
      (select count(*)::int from videos where themed_at is null and status <> 'failed')
        + (select count(*)::int from courses where themed_at is null) as never_run,
      (select count(*)::int from videos v where v.themed_at is not null and not exists
        (select 1 from theme_assignments a where a.video_id = v.id and a.status = 'active'))
        + (select count(*)::int from courses c where c.themed_at is not null and not exists
        (select 1 from theme_assignments a where a.course_id = c.id and a.status = 'active')) as no_theme`);
  return { neverRun: row?.never_run ?? 0, noTheme: row?.no_theme ?? 0 };
}

