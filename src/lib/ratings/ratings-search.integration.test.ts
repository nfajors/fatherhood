/**
 * Ratings, reviews and search against a real Postgres (the search documents
 * are generated columns, so they only exist there). Runs only when
 * TEST_DATABASE_URL points at a disposable database (tables are truncated).
 */
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addLesson, addModule, createCourse, setPublished, updateCourse } from "@/lib/courses/admin";
import { listCommunityVideos, listPublishedCourses } from "@/lib/courses/catalog";
import type { Database } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { search, snippetParts } from "@/lib/search/search";
import {
  listReviews,
  myRating,
  rate,
  ratingBlocker,
  ratingSummary,
  recentReviews,
  removeRating,
  reviewerName,
  setHelpful,
  setReviewHidden,
} from "./service";

const url = process.env.TEST_DATABASE_URL;
const T0 = new Date("2026-10-18T12:00:00Z");
const at = (s: number) => new Date(T0.getTime() + s * 1000);

describe.skipIf(!url)("ratings and search (Postgres)", () => {
  let client: postgres.Sql;
  let db: Database;

  beforeAll(async () => {
    client = postgres(url!, { max: 4, onnotice: () => {} });
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: "drizzle" });
  });

  afterAll(async () => {
    await client?.end();
  });

  const viewers = ["v1", "v2", "v3", "v4", "v5", "v6"];
  beforeEach(async () => {
    await db.execute(sql`truncate review_helpful_votes, ratings, watch_sessions, watch_progress, theme_assignments, themes, lessons, course_modules, courses, videos, "user" cascade`);
    await db.insert(schema.user).values([
      { id: "author", name: "The Author", email: "author@test.dev", role: "admin" },
      { id: "fellow", name: "James Okafor", email: "james@test.dev", role: "creator" },
      ...viewers.map((id) => ({ id, name: `Dad ${id.toUpperCase()} Smith`, email: `${id}@test.dev` })),
    ]);
    n = 0;
  });

  let n = 0;
  async function video(overrides: Partial<typeof schema.videos.$inferInsert> = {}) {
    n++;
    const [row] = await db
      .insert(schema.videos)
      .values({ type: "community", status: "approved", creatorId: "fellow", title: `Video ${n}`, cloudflareUid: `cf${n}`, durationSeconds: 300, requireSignedUrls: false, publishedAt: at(n), ...overrides })
      .returning();
    return row!;
  }
  /** Let a viewer qualify to rate by watching 45 seconds. */
  async function watched(videoId: string, userId: string, seconds = 45) {
    await db.insert(schema.watchSessions).values({ videoId, userId, secondsWatched: seconds, startedAt: T0 });
  }
  const row = async (id: string) => (await db.query.videos.findFirst({ where: eq(schema.videos.id, id) }))!;

  describe("ratings", () => {
    it("lets viewers who watched rate once, edit and remove, keeping the average current", async () => {
      const v = await video();
      await watched(v.id, "v1");
      await watched(v.id, "v2");
      await rate(db, { videoId: v.id, userId: "v1", stars: 5, review: "  Exactly what I needed.  " });
      await rate(db, { videoId: v.id, userId: "v2", stars: 4 });
      expect(await row(v.id)).toMatchObject({ ratingAverage: "4.50", ratingCount: 2 });

      await rate(db, { videoId: v.id, userId: "v2", stars: 2, review: "Too short." });
      expect(await row(v.id)).toMatchObject({ ratingAverage: "3.50", ratingCount: 2 });
      expect(await myRating(db, v.id, "v1")).toEqual({ stars: 5, review: "Exactly what I needed.", reviewHidden: false });

      await removeRating(db, v.id, "v2");
      expect(await row(v.id)).toMatchObject({ ratingAverage: "5.00", ratingCount: 1 });
      await removeRating(db, v.id, "v1");
      expect(await row(v.id)).toMatchObject({ ratingAverage: null, ratingCount: 0 });
    });

    it("refuses creators, viewers who haven't watched, and unpublished videos", async () => {
      const v = await video();
      expect(await ratingBlocker(db, "fellow", v.id)).toMatchObject({ reason: "own_video" });
      expect(await ratingBlocker(db, "v1", v.id)).toMatchObject({ reason: "not_watched" });
      await watched(v.id, "v1", 20);
      await expect(rate(db, { videoId: v.id, userId: "v1", stars: 5 })).rejects.toMatchObject({ reason: "not_watched" });
      await watched(v.id, "v1", 15); // two sessions add up to 35 seconds
      expect(await ratingBlocker(db, "v1", v.id)).toBeNull();

      await db.insert(schema.watchProgress).values({ userId: "v2", videoId: v.id, completed: true, positionSeconds: 0 });
      expect(await ratingBlocker(db, "v2", v.id)).toBeNull(); // marked complete counts

      const hidden = await video({ status: "unpublished" });
      await watched(hidden.id, "v1");
      expect(await ratingBlocker(db, "v1", hidden.id)).toMatchObject({ reason: "not_found" });
      await expect(rate(db, { videoId: v.id, userId: "v1", stars: 6 })).rejects.toBeInstanceOf(RangeError);
    });

    it("summarizes the distribution and lists reviews by helpfulness or date", async () => {
      const v = await video();
      for (const id of viewers) await watched(v.id, id);
      await rate(db, { videoId: v.id, userId: "v1", stars: 5, review: "First and best." }, at(1));
      await rate(db, { videoId: v.id, userId: "v2", stars: 4, review: "Useful." }, at(2));
      await rate(db, { videoId: v.id, userId: "v3", stars: 4 }, at(3)); // stars only: not listed
      await rate(db, { videoId: v.id, userId: "v4", stars: 1, review: "Not for me." }, at(4));

      expect(await ratingSummary(db, v.id)).toEqual({
        average: 3.5,
        count: 4,
        distribution: [
          { stars: 5, count: 1 },
          { stars: 4, count: 2 },
          { stars: 3, count: 0 },
          { stars: 2, count: 0 },
          { stars: 1, count: 1 },
        ],
      });

      const [first] = (await listReviews(db, v.id, { sort: "newest" })).reviews;
      await setHelpful(db, (await listReviews(db, v.id)).reviews.find((r) => r.review === "Useful.")!.id, "v5", true);
      await setHelpful(db, (await listReviews(db, v.id)).reviews.find((r) => r.review === "Useful.")!.id, "v6", true);
      const helpful = await listReviews(db, v.id, { sort: "helpful", viewerId: "v5" });
      expect(helpful.total).toBe(3);
      expect(helpful.reviews.map((r) => [r.review, r.helpfulCount, r.votedHelpful])).toEqual([
        ["Useful.", 2, true],
        ["Not for me.", 0, false],
        ["First and best.", 0, false],
      ]);
      expect(first!.review).toBe("Not for me.");
      expect(helpful.reviews[0]!.author).toBe("Dad S.");
    });

    it("toggles helpful votes once per person, never on your own review", async () => {
      const v = await video();
      await watched(v.id, "v1");
      const rating = await rate(db, { videoId: v.id, userId: "v1", stars: 5, review: "Good." });
      expect(await setHelpful(db, rating.id, "v2", true)).toEqual({ helpful: true, helpfulCount: 1 });
      expect(await setHelpful(db, rating.id, "v2", true)).toEqual({ helpful: true, helpfulCount: 1 });
      expect(await setHelpful(db, rating.id, "v2", false)).toEqual({ helpful: false, helpfulCount: 0 });
      await expect(setHelpful(db, rating.id, "v1", true)).rejects.toMatchObject({ reason: "own_review" });
    });

    it("lets admins hide a review's text while its stars keep counting", async () => {
      const v = await video();
      await watched(v.id, "v1");
      const rating = await rate(db, { videoId: v.id, userId: "v1", stars: 1, review: "Something abusive." });
      await setReviewHidden(db, rating.id, true, "author", T0);
      expect((await listReviews(db, v.id)).total).toBe(0);
      expect(await row(v.id)).toMatchObject({ ratingCount: 1 });
      expect(await myRating(db, v.id, "v1")).toMatchObject({ reviewHidden: true });
      // Editing doesn't bring a hidden review back.
      await rate(db, { videoId: v.id, userId: "v1", stars: 1, review: "Rewritten." });
      expect((await listReviews(db, v.id)).total).toBe(0);
      expect((await recentReviews(db, { hiddenOnly: true })).map((r) => r.review)).toEqual(["Rewritten."]);
      await setReviewHidden(db, rating.id, false, "author");
      expect((await listReviews(db, v.id)).total).toBe(1);
    });

    it("shortens reviewer names", () => {
      expect(reviewerName("Marcus Reid")).toBe("Marcus R.");
      expect(reviewerName("  Sam ")).toBe("Sam");
      expect(reviewerName("Jean Paul de la cruz")).toBe("Jean C.");
      expect(reviewerName("")).toBe("A father");
    });

    it("shows ratings on cards and sorts Community by top rated and most viewed", async () => {
      const newest = await video({ title: "Newest", viewCount: 5 });
      const loved = await video({ title: "Loved", viewCount: 50 });
      const once = await video({ title: "One five-star", viewCount: 1 });
      for (const id of viewers) await watched(loved.id, id);
      for (const id of viewers) await rate(db, { videoId: loved.id, userId: id, stars: 5 });
      await rate(db, { videoId: loved.id, userId: "v6", stars: 4 });
      await watched(once.id, "v1");
      await rate(db, { videoId: once.id, userId: "v1", stars: 5 });
      await db.update(schema.videos).set({ publishedAt: at(100) }).where(eq(schema.videos.id, newest.id));

      const titles = async (sort: "newest" | "top_rated" | "most_viewed") => (await listCommunityVideos(db, { sort })).videos.map((v) => v.title);
      expect(await titles("newest")).toEqual(["Newest", "One five-star", "Loved"]);
      // Six ratings averaging 4.83 beat one 5-star rating; unrated videos come last.
      expect(await titles("top_rated")).toEqual(["Loved", "One five-star", "Newest"]);
      const meh = await video({ title: "Meh" });
      await watched(meh.id, "v2");
      await rate(db, { videoId: meh.id, userId: "v2", stars: 2 });
      expect(await titles("top_rated")).toEqual(["Loved", "One five-star", "Meh", "Newest"]);
      expect(await titles("most_viewed")).toEqual(["Loved", "Newest", "One five-star", "Meh"]);
      expect((await listCommunityVideos(db, {})).videos.find((v) => v.title === "Loved")).toMatchObject({ ratingAverage: "4.83", ratingCount: 6 });
    });
  });

  describe("search", () => {
    async function course() {
      const lessonVideo = await video({ type: "professional", creatorId: "author", requireSignedUrls: true, title: "Fragile Families", transcript: "The study followed five thousand births in American cities." });
      const other = await video({ type: "professional", creatorId: "author", requireSignedUrls: true, title: "The phone call" });
      const c = await createCourse(db, { title: "Why Fathers Matter", category: "Research" });
      await updateCourse(db, c.id, { description: "What decades of research say about fathers and children." });
      const m = await addModule(db, c.id, "The evidence");
      await addLesson(db, m.id, { title: "Fragile Families", summary: "A landmark birth cohort study.", videoId: lessonVideo.id });
      await addLesson(db, m.id, { title: "The phone call", videoId: other.id, isPreview: true });
      await setPublished(db, c.id, true, T0);
      return c;
    }

    it("finds courses, lessons (by transcript too) and Community videos, with highlighted snippets", async () => {
      await course();
      await video({ title: "Bedtime over a video call", description: "I work nights, so bedtime happens on a screen.", tags: ["night shifts"] });
      await video({ title: "Coaching my son", transcript: "Coaching taught me to apologize when I yell." });

      const results = await search(db, "births");
      expect(results.lessons.items.map((l) => l.title)).toEqual(["Fragile Families"]);
      expect(snippetParts(results.lessons.items[0]!.snippet).filter((p) => p.mark).map((p) => p.text)).toContain("births");
      // The course is found through its lesson.
      expect(results.courses.items).toMatchObject([{ slug: "why-fathers-matter", matchedLessons: 1, lessonCount: 2 }]);

      expect((await search(db, "research")).courses.items.map((c) => c.title)).toEqual(["Why Fathers Matter"]);
      expect((await search(db, "night shift")).community.items.map((v) => v.title)).toEqual(["Bedtime over a video call"]);
      // Stemming: "apologizing" finds "apologize".
      expect((await search(db, "apologizing")).community.items.map((v) => v.title)).toEqual(["Coaching my son"]);
      // Web-search syntax: exclude a word.
      expect((await search(db, "bedtime -nights")).community.total).toBe(0);
    });

    it("falls back to prefixes for partly typed words", async () => {
      await video({ title: "Coaching my son" });
      const results = await search(db, "coachi");
      expect(results.matchedPrefixes).toBe(true);
      expect(results.community.items.map((v) => v.title)).toEqual(["Coaching my son"]);
      expect((await search(db, "zzzz")).community.total).toBe(0);
    });

    it("never finds unpublished things", async () => {
      const c = await course();
      await video({ title: "Pending bedtime story", status: "pending_review" });
      await setPublished(db, c.id, false);
      const results = await search(db, "families bedtime");
      expect(results.courses.total + results.lessons.total + results.community.total).toBe(0);
      expect((await search(db, "fragile")).lessons.total).toBe(0);
    });

    it("filters by type and category and pages through results", async () => {
      await course();
      for (let i = 0; i < 5; i++) await video({ title: `Bedtime story ${i}`, category: i % 2 ? "Presence" : "Personal Stories" });
      const all = await search(db, "bedtime");
      expect(all.community.items).toHaveLength(5);
      expect(all.courses.total).toBe(0);

      const page = await search(db, "bedtime", { type: "community", limit: 2, offset: 2, sort: "newest" });
      expect(page.community.total).toBe(5);
      expect(page.community.items.map((v) => v.title)).toEqual(["Bedtime story 2", "Bedtime story 1"]);
      expect((await search(db, "bedtime", { type: "lessons" })).community.total).toBe(0);
      expect((await search(db, "bedtime", { category: "Presence" })).community.total).toBe(2);
    });

    it("finds themes by name and description", async () => {
      await db.insert(schema.themes).values({ slug: "presence", name: "Presence", description: "Showing up for your children every day.", status: "active", origin: "book" });
      await db.insert(schema.themes).values({ slug: "draft", name: "Presence drafts", description: "x", status: "proposed", origin: "ai" });
      expect((await search(db, "showing up")).themes.map((t) => t.slug)).toEqual(["presence"]);
    });

    it("shows course ratings from their lesson videos", async () => {
      await course();
      const [lesson] = await db.select().from(schema.lessons).where(eq(schema.lessons.title, "Fragile Families"));
      await watched(lesson!.videoId!, "v1");
      await rate(db, { videoId: lesson!.videoId!, userId: "v1", stars: 4 });
      expect((await listPublishedCourses(db, null))[0]).toMatchObject({ ratingAverage: 4, ratingCount: 1 });
      expect((await search(db, "fathers")).courses.items[0]).toMatchObject({ ratingAverage: 4, ratingCount: 1 });
    });
  });
});
