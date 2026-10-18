/**
 * Collections: admin-curated playlists of courses and Community videos, such
 * as "Start Here" and "Book Companion" (docs/development-plan.md 3.1 Search &
 * Discovery). Visitors only ever see published collections, and within them
 * only published courses and approved Community videos.
 */
import { and, asc, count, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { collectionItems, collections, courses, videos } from "@/lib/db/schema";
import { communityCardsByIds, listPublishedCourses, type CommunityCard, type CourseCard } from "@/lib/courses/catalog";
import { slugify } from "@/lib/slug";

export class CollectionError extends Error {
  constructor(
    readonly reason: "not_found" | "slug_taken" | "invalid",
    message: string,
  ) {
    super(message);
    this.name = "CollectionError";
  }
}

export type Collection = typeof collections.$inferSelect;

export async function createCollection(db: Database, title: string): Promise<Collection> {
  const slug = slugify(title);
  if (!slug) throw new CollectionError("invalid", "Give the collection a title with letters or numbers.");
  const [row] = await db.insert(collections).values({ title: title.trim(), slug }).onConflictDoNothing({ target: collections.slug }).returning();
  if (!row) throw new CollectionError("slug_taken", `A collection already uses the address /collections/${slug}.`);
  return row;
}

export async function updateCollection(
  db: Database,
  id: string,
  changes: Partial<{ title: string; slug: string; description: string | null; published: boolean; featured: boolean; sortOrder: number }>,
): Promise<Collection> {
  const set: Partial<typeof collections.$inferInsert> = { ...changes };
  if (changes.title !== undefined) set.title = changes.title.trim();
  if (changes.slug !== undefined) {
    const slug = slugify(changes.slug);
    if (!slug) throw new CollectionError("invalid", "The address needs letters or numbers.");
    const [taken] = await db.select({ id: collections.id }).from(collections).where(and(eq(collections.slug, slug), sql`${collections.id} <> ${id}`));
    if (taken) throw new CollectionError("slug_taken", `A collection already uses the address /collections/${slug}.`);
    set.slug = slug;
  }
  const [row] = await db.update(collections).set(set).where(eq(collections.id, id)).returning();
  if (!row) throw new CollectionError("not_found", "Collection not found.");
  return row;
}

export async function deleteCollection(db: Database, id: string): Promise<void> {
  const [row] = await db.delete(collections).where(eq(collections.id, id)).returning({ id: collections.id });
  if (!row) throw new CollectionError("not_found", "Collection not found.");
}

/** Add a course or a Community video at the end. Adding the same thing twice is refused. */
export async function addItem(db: Database, collectionId: string, target: { courseId?: string; videoId?: string; note?: string | null }) {
  if (Boolean(target.courseId) === Boolean(target.videoId)) throw new CollectionError("invalid", "Choose a course or a video.");
  if (target.videoId) {
    const [video] = await db.select({ type: videos.type }).from(videos).where(eq(videos.id, target.videoId));
    if (!video || video.type !== "community") throw new CollectionError("invalid", "Collections hold courses and Community videos. Lessons belong in courses.");
  } else {
    const [course] = await db.select({ id: courses.id }).from(courses).where(eq(courses.id, target.courseId!));
    if (!course) throw new CollectionError("invalid", "Course not found.");
  }
  return db.transaction(async (tx) => {
    const [collection] = await tx.select({ id: collections.id }).from(collections).where(eq(collections.id, collectionId)).for("update");
    if (!collection) throw new CollectionError("not_found", "Collection not found.");
    const [{ next } = { next: 1 }] = await tx
      .select({ next: sql<number>`coalesce(max(${collectionItems.position}), 0)::int + 1` })
      .from(collectionItems)
      .where(eq(collectionItems.collectionId, collectionId));
    const [row] = await tx
      .insert(collectionItems)
      .values({ collectionId, courseId: target.courseId ?? null, videoId: target.videoId ?? null, note: target.note?.trim() || null, position: next })
      .onConflictDoNothing()
      .returning();
    if (!row) throw new CollectionError("invalid", "That's already in this collection.");
    return row;
  });
}

export async function updateItemNote(db: Database, itemId: string, note: string | null) {
  const [row] = await db.update(collectionItems).set({ note: note?.trim() || null }).where(eq(collectionItems.id, itemId)).returning({ id: collectionItems.id });
  if (!row) throw new CollectionError("not_found", "Item not found.");
}

export async function removeItem(db: Database, itemId: string) {
  const [row] = await db.delete(collectionItems).where(eq(collectionItems.id, itemId)).returning({ id: collectionItems.id });
  if (!row) throw new CollectionError("not_found", "Item not found.");
}

export async function moveItem(db: Database, itemId: string, direction: "up" | "down"): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [item] = await tx.select().from(collectionItems).where(eq(collectionItems.id, itemId)).for("update");
    if (!item) throw new CollectionError("not_found", "Item not found.");
    const [neighbor] = await tx
      .select({ id: collectionItems.id, position: collectionItems.position })
      .from(collectionItems)
      .where(
        and(
          eq(collectionItems.collectionId, item.collectionId),
          direction === "up" ? lt(collectionItems.position, item.position) : gt(collectionItems.position, item.position),
        ),
      )
      .orderBy(direction === "up" ? desc(collectionItems.position) : asc(collectionItems.position))
      .limit(1);
    if (!neighbor) return false;
    await tx.update(collectionItems).set({ position: neighbor.position }).where(eq(collectionItems.id, item.id));
    await tx.update(collectionItems).set({ position: item.position }).where(eq(collectionItems.id, neighbor.id));
    return true;
  });
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export type CollectionEntry =
  | { itemId: string; note: string | null; kind: "course"; course: CourseCard }
  | { itemId: string; note: string | null; kind: "video"; video: CommunityCard };

/** Resolve items to cards, dropping anything not public (unpublished course, unapproved video). */
async function resolveItems(db: Database, items: (typeof collectionItems.$inferSelect)[], userId: string | null): Promise<CollectionEntry[]> {
  const videoIds = items.flatMap((i) => (i.videoId ? [i.videoId] : []));
  const [courseCards, videoCards] = await Promise.all([
    items.some((i) => i.courseId) ? listPublishedCourses(db, userId) : Promise.resolve([]),
    communityCardsByIds(db, videoIds),
  ]);
  return items.flatMap((i): CollectionEntry[] => {
    if (i.courseId) {
      const course = courseCards.find((c) => c.id === i.courseId);
      return course ? [{ itemId: i.id, note: i.note, kind: "course", course }] : [];
    }
    const video = videoCards.find((v) => v.id === i.videoId);
    return video ? [{ itemId: i.id, note: i.note, kind: "video", video }] : [];
  });
}

async function itemsOf(db: Database, collectionIds: string[]) {
  if (collectionIds.length === 0) return [];
  return db.select().from(collectionItems).where(inArray(collectionItems.collectionId, collectionIds)).orderBy(asc(collectionItems.position));
}

/** One collection with its public items; null when it doesn't exist or isn't published (unless asked). */
export async function getCollection(db: Database, slug: string, options: { userId?: string | null; includeUnpublished?: boolean } = {}) {
  const [collection] = await db.select().from(collections).where(eq(collections.slug, slug));
  if (!collection || (!collection.published && !options.includeUnpublished)) return null;
  return { collection, entries: await resolveItems(db, await itemsOf(db, [collection.id]), options.userId ?? null) };
}

/** Published collections in order, each with up to `preview` public items; empty ones are left out. */
export async function publishedCollections(db: Database, options: { featuredOnly?: boolean; preview?: number; userId?: string | null } = {}) {
  const rows = await db
    .select()
    .from(collections)
    .where(and(eq(collections.published, true), options.featuredOnly ? eq(collections.featured, true) : undefined))
    .orderBy(asc(collections.sortOrder), asc(collections.title));
  const items = await itemsOf(db, rows.map((r) => r.id));
  const entries = await resolveItems(db, items, options.userId ?? null);
  return rows
    .map((collection) => {
      const mine = entries.filter((e) => items.find((i) => i.id === e.itemId)?.collectionId === collection.id);
      return { collection, total: mine.length, entries: options.preview ? mine.slice(0, options.preview) : mine };
    })
    .filter((c) => c.total > 0);
}

/** All collections for the admin list, with raw item counts. */
export async function adminCollections(db: Database) {
  return db
    .select({
      id: collections.id,
      slug: collections.slug,
      title: collections.title,
      published: collections.published,
      featured: collections.featured,
      items: count(collectionItems.id),
    })
    .from(collections)
    .leftJoin(collectionItems, eq(collectionItems.collectionId, collections.id))
    .groupBy(collections.id)
    .orderBy(asc(collections.sortOrder), asc(collections.title));
}

/** The admin editor: every item, including ones not currently public, with a label. */
export async function adminCollectionItems(db: Database, collectionId: string) {
  return db
    .select({
      id: collectionItems.id,
      note: collectionItems.note,
      courseId: collectionItems.courseId,
      videoId: collectionItems.videoId,
      courseTitle: courses.title,
      coursePublished: courses.published,
      videoTitle: videos.title,
      videoStatus: videos.status,
    })
    .from(collectionItems)
    .leftJoin(courses, eq(collectionItems.courseId, courses.id))
    .leftJoin(videos, eq(collectionItems.videoId, videos.id))
    .where(eq(collectionItems.collectionId, collectionId))
    .orderBy(asc(collectionItems.position));
}

/** What can be added: courses (any) and approved Community videos. */
export async function collectionOptions(db: Database) {
  const [courseRows, videoRows] = await Promise.all([
    db.select({ id: courses.id, title: courses.title, published: courses.published }).from(courses).orderBy(asc(courses.title)),
    db
      .select({ id: videos.id, title: videos.title })
      .from(videos)
      .where(and(eq(videos.type, "community"), eq(videos.status, "approved")))
      .orderBy(desc(videos.publishedAt))
      .limit(500),
  ]);
  return { courses: courseRows, videos: videoRows };
}
