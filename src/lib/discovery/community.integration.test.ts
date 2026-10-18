/**
 * Comments, collections, recommendations and trending against a real
 * Postgres. Runs only when TEST_DATABASE_URL points at a disposable database
 * (tables are truncated).
 */
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "@/lib/auth";
import {
  addItem as addCollectionItem,
  createCollection,
  getCollection,
  moveItem,
  publishedCollections,
  removeItem,
  updateCollection,
} from "@/lib/collections/service";
import {
  canComment,
  deleteOwnComment,
  editComment,
  listComments,
  moderateComment,
  moderationList,
  postComment,
  reportComment,
} from "@/lib/comments/service";
import { addLesson, addModule, createCourse, setPublished } from "@/lib/courses/admin";
import { listCommunityVideos } from "@/lib/courses/catalog";
import type { Database } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { recommendFor, tasteProfile } from "./recommend";

const url = process.env.TEST_DATABASE_URL;
const T0 = new Date("2026-10-18T12:00:00Z");
const minutes = (m: number) => new Date(T0.getTime() + m * 60_000);
const person = (id: string, role: SessionUser["role"] = "user"): SessionUser => ({ id, role, email: `${id}@test.dev`, name: id, stripeCustomerId: null });

describe.skipIf(!url)("comments and discovery (Postgres)", () => {
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

  beforeEach(async () => {
    await db.execute(
      sql`truncate comment_reports, comments, collection_items, collections, ratings, watch_sessions, watch_progress, theme_assignments, themes, lessons, course_modules, courses, subscriptions, videos, "user" cascade`,
    );
    await db.insert(schema.user).values([
      { id: "author", name: "The Author", email: "author@test.dev", role: "admin" },
      { id: "fellow", name: "James Okafor", email: "james@test.dev", role: "creator" },
      ...["a", "b", "c", "d"].map((id) => ({ id, name: `Dad ${id.toUpperCase()} Smith`, email: `${id}@test.dev` })),
      { id: "member", name: "Member Jones", email: "member@test.dev" },
    ]);
    await db.insert(schema.subscriptions).values({ userId: "member", plan: "annual", status: "active", currentPeriodEnd: new Date("2030-01-01") });
    n = 0;
  });

  let n = 0;
  async function video(overrides: Partial<typeof schema.videos.$inferInsert> = {}) {
    n++;
    const [row] = await db
      .insert(schema.videos)
      .values({ type: "community", status: "approved", creatorId: "fellow", title: `Video ${n}`, cloudflareUid: `cf${n}`, durationSeconds: 300, requireSignedUrls: false, publishedAt: minutes(n), ...overrides })
      .returning();
    return row!;
  }
  async function theme(slug: string) {
    const [row] = await db.insert(schema.themes).values({ slug, name: slug[0]!.toUpperCase() + slug.slice(1), description: slug, status: "active", origin: "book" }).returning();
    return row!;
  }
  async function place(themeId: string, target: { videoId?: string; courseId?: string }, isPrimary = true) {
    await db.insert(schema.themeAssignments).values({ themeId, ...target, source: "admin", isPrimary });
  }
  async function watched(videoId: string, userId: string, seconds = 60, startedAt = new Date()) {
    await db.insert(schema.watchSessions).values({ videoId, userId, secondsWatched: seconds, startedAt });
  }

  describe("comments", () => {
    it("posts threads with one level of replies, newest threads first, with badges", async () => {
      const v = await video();
      const first = await postComment(db, person("a"), { videoId: v.id, body: "  This hit home.  " }, T0);
      const second = await postComment(db, person("b"), { videoId: v.id, body: "Same here." }, minutes(1));
      const reply = await postComment(db, person("fellow", "creator"), { videoId: v.id, body: "Thank you both.", parentId: first.id }, minutes(2));
      // A reply to a reply joins the same thread.
      const nested = await postComment(db, person("author", "admin"), { videoId: v.id, body: "Welcome.", parentId: reply.id }, minutes(3));
      expect(nested.parentId).toBe(first.id);

      const { threads, total } = await listComments(db, v.id, { viewerId: "a" });
      expect(total).toBe(4);
      expect(threads.map((t) => [t.body, t.author, t.isOwn, t.replies.map((r) => [r.body, r.badge])])).toEqual([
        ["Same here.", "Dad S.", false, []],
        ["This hit home.", "Dad S.", true, [["Thank you both.", "creator"], ["Welcome.", "team"]]],
      ]);
      expect(second.body).toBe("Same here.");
    });

    it("lets only viewers who can watch comment, and rejects empty or long comments", async () => {
      const paid = await video({ type: "professional", creatorId: "author", requireSignedUrls: true });
      expect(await canComment(db, null, paid.id)).toBe(false);
      expect(await canComment(db, person("a"), paid.id)).toBe(false);
      expect(await canComment(db, person("member"), paid.id)).toBe(true);
      await expect(postComment(db, person("a"), { videoId: paid.id, body: "Hi there" })).rejects.toMatchObject({ reason: "not_allowed" });
      const pending = await video({ status: "pending_review" });
      expect(await canComment(db, person("a"), pending.id)).toBe(false);

      const v = await video();
      await expect(postComment(db, person("a"), { videoId: v.id, body: " x " })).rejects.toMatchObject({ reason: "invalid" });
      await expect(postComment(db, person("a"), { videoId: v.id, body: "y".repeat(2001) })).rejects.toMatchObject({ reason: "invalid" });
    });

    it("slows down rapid posting", async () => {
      const v = await video();
      for (let i = 0; i < 5; i++) await postComment(db, person("a"), { videoId: v.id, body: `Comment ${i}` }, minutes(i));
      await expect(postComment(db, person("a"), { videoId: v.id, body: "One more" }, minutes(5))).rejects.toMatchObject({ reason: "rate_limited" });
      expect(await postComment(db, person("a"), { videoId: v.id, body: "Later" }, minutes(11))).toBeTruthy();
    });

    it("lets authors edit and delete their own, keeping replies under a placeholder", async () => {
      const v = await video();
      const top = await postComment(db, person("a"), { videoId: v.id, body: "Original" }, T0);
      await postComment(db, person("b"), { videoId: v.id, body: "A reply", parentId: top.id }, minutes(1));
      await expect(editComment(db, "b", top.id, "Hijack")).rejects.toMatchObject({ reason: "not_yours" });
      expect(await editComment(db, "a", top.id, "Edited", minutes(2))).toMatchObject({ body: "Edited", editedAt: minutes(2) });

      await deleteOwnComment(db, "a", top.id);
      const [thread] = (await listComments(db, v.id)).threads;
      expect(thread).toMatchObject({ deleted: true, body: "", author: "", replies: [{ body: "A reply" }] });
      // Without visible replies a deleted comment disappears.
      const lonely = await postComment(db, person("c"), { videoId: v.id, body: "Alone" }, minutes(3));
      await deleteOwnComment(db, "c", lonely.id);
      expect((await listComments(db, v.id)).threads).toHaveLength(1);
    });

    it("hides a comment at three reporters, shows it to its author as under review, and lets admins decide", async () => {
      const v = await video();
      const c = await postComment(db, person("a"), { videoId: v.id, body: "Something rude" }, T0);
      await expect(reportComment(db, { commentId: c.id, reporterId: "a", reason: "harassment_or_hate" })).rejects.toMatchObject({ reason: "not_allowed" });
      expect(await reportComment(db, { commentId: c.id, reporterId: "b", reason: "harassment_or_hate" })).toEqual({ alreadyReported: false, hidden: false });
      expect(await reportComment(db, { commentId: c.id, reporterId: "b", reason: "spam" })).toEqual({ alreadyReported: true, hidden: false });
      await reportComment(db, { commentId: c.id, reporterId: "c", reason: "spam" });
      expect(await reportComment(db, { commentId: c.id, reporterId: "d", reason: "spam" })).toEqual({ alreadyReported: false, hidden: true });

      expect((await listComments(db, v.id, { viewerId: "b" })).threads).toEqual([]);
      expect((await listComments(db, v.id, { viewerId: "a" })).threads[0]).toMatchObject({ underReview: true, isOwn: true });
      await expect(editComment(db, "a", c.id, "Nicer now")).rejects.toMatchObject({ reason: "not_allowed" });

      const [queued] = await moderationList(db, { filter: "reported" });
      expect(queued).toMatchObject({ id: c.id, status: "hidden", openReports: 3 });
      expect([...queued!.reasons].sort()).toEqual(["harassment_or_hate", "spam"]);

      await moderateComment(db, c.id, "restore", "author");
      expect((await listComments(db, v.id)).total).toBe(1);
      expect(await moderationList(db, { filter: "reported" })).toEqual([]);
      await moderateComment(db, c.id, "remove", "author");
      expect((await listComments(db, v.id)).total).toBe(0);
    });
  });

  describe("collections", () => {
    it("curates courses and Community videos, showing only what's public", async () => {
      const c = await createCourse(db, { title: "Why Fathers Matter" });
      const lessonVideo = await video({ type: "professional", creatorId: "author", requireSignedUrls: true });
      const m = await addModule(db, c.id, "M");
      await addLesson(db, m.id, { title: "L", videoId: lessonVideo.id });
      const story = await video({ title: "Bedtime story" });
      const pending = await video({ title: "Pending", status: "pending_review" });

      const startHere = await createCollection(db, "Start Here");
      expect(startHere).toMatchObject({ slug: "start-here", published: false });
      await expect(createCollection(db, "start here")).rejects.toMatchObject({ reason: "slug_taken" });
      const courseItem = await addCollectionItem(db, startHere.id, { courseId: c.id, note: " Begin here. " });
      await addCollectionItem(db, startHere.id, { videoId: story.id });
      await addCollectionItem(db, startHere.id, { videoId: pending.id });
      await expect(addCollectionItem(db, startHere.id, { videoId: story.id })).rejects.toMatchObject({ reason: "invalid" });
      await expect(addCollectionItem(db, startHere.id, { videoId: lessonVideo.id })).rejects.toThrowError(/Lessons belong in courses/);

      // Unpublished collection: hidden from visitors, visible to admins.
      expect(await getCollection(db, "start-here")).toBeNull();
      const draft = (await getCollection(db, "start-here", { includeUnpublished: true }))!;
      // The course isn't published yet and the pending video isn't approved.
      expect(draft.entries.map((e) => e.kind)).toEqual(["video"]);

      await setPublished(db, c.id, true);
      await updateCollection(db, startHere.id, { published: true, featured: true, description: "New here? Begin with these." });
      const live = (await getCollection(db, "start-here"))!;
      expect(live.entries.map((e) => [e.kind, e.note])).toEqual([
        ["course", "Begin here."],
        ["video", null],
      ]);

      await moveItem(db, courseItem.id, "down");
      const [featured] = await publishedCollections(db, { featuredOnly: true, preview: 1 });
      expect(featured).toMatchObject({ total: 2, collection: { title: "Start Here" } });
      expect(featured!.entries.map((e) => e.kind)).toEqual(["video"]);

      await removeItem(db, courseItem.id);
      await createCollection(db, "Empty one").then((e) => updateCollection(db, e.id, { published: true }));
      expect((await publishedCollections(db)).map((x) => x.collection.title)).toEqual(["Start Here"]); // empty ones left out
    });
  });

  describe("recommendations", () => {
    it("builds taste from watching and rating, and recommends unwatched videos and unstarted courses on those themes", async () => {
      const presence = await theme("presence");
      const discipline = await theme("discipline");
      const watchedPresence = await video({ title: "Watched presence" });
      const lovedPresence = await video({ title: "Loved presence" });
      const dislikedDiscipline = await video({ title: "Disliked discipline" });
      const nextPresence = await video({ title: "Next presence" });
      const secondaryPresence = await video({ title: "Secondary presence" });
      const nextDiscipline = await video({ title: "Next discipline" });
      await place(presence.id, { videoId: watchedPresence.id });
      await place(presence.id, { videoId: lovedPresence.id });
      await place(discipline.id, { videoId: dislikedDiscipline.id });
      await place(presence.id, { videoId: nextPresence.id });
      await place(presence.id, { videoId: secondaryPresence.id }, false);
      await place(discipline.id, { videoId: nextDiscipline.id });

      await watched(watchedPresence.id, "a");
      await watched(lovedPresence.id, "a");
      await db.insert(schema.ratings).values({ videoId: lovedPresence.id, userId: "a", stars: 5 });
      await watched(dislikedDiscipline.id, "a");
      await db.insert(schema.ratings).values({ videoId: dislikedDiscipline.id, userId: "a", stars: 1 });

      const profile = await tasteProfile(db, "a");
      expect(profile.get(presence.id)).toBe(1 + 3); // watched (1) + loved (1 + 2 for five stars)
      expect(profile.get(discipline.id)).toBe(-1); // watched (1) - 2 for one star

      const course = await createCourse(db, { title: "Being there" });
      const lv = await video({ type: "professional", creatorId: "author", requireSignedUrls: true });
      const m = await addModule(db, course.id, "M");
      await addLesson(db, m.id, { title: "L", videoId: lv.id });
      await setPublished(db, course.id, true);
      await place(presence.id, { courseId: course.id });

      const recs = await recommendFor(db, "a", { videos: 3, courses: 2 });
      expect(recs.personalized).toBe(true);
      // Primary-theme match first, secondary next; the disliked theme isn't recommended, watched ones never are.
      expect(recs.videos.slice(0, 2).map((v) => [v.title, v.reason])).toEqual([
        ["Next presence", "Presence"],
        ["Secondary presence", "Presence"],
      ]);
      expect(recs.videos.map((v) => v.title)).not.toContain("Watched presence");
      expect(recs.courses.map((c) => [c.title, c.reason])).toEqual([["Being there", "Presence"]]);
      // Filled up with popular picks to the requested size.
      expect(recs.videos).toHaveLength(3);
    });

    it("gives visitors and newcomers popular picks, trending first", async () => {
      const quiet = await video({ title: "Quiet" });
      const busy = await video({ title: "Busy" });
      for (const id of ["a", "b", "c"]) await watched(busy.id, id);
      await watched(quiet.id, "d", 60, new Date(Date.now() - 30 * 24 * 3_600_000)); // old views don't trend

      const recs = await recommendFor(db, null, { videos: 2 });
      expect(recs.personalized).toBe(false);
      expect(recs.videos.map((v) => [v.title, v.reason])).toEqual([
        ["Busy", null],
        ["Quiet", null],
      ]);
      expect((await listCommunityVideos(db, { sort: "trending" })).videos.map((v) => v.title)).toEqual(["Busy", "Quiet"]);
      // Their own uploads and what they've watched aren't recommended back.
      expect((await recommendFor(db, "fellow")).videos).toEqual([]);
      expect((await recommendFor(db, "a")).videos.map((v) => v.title)).toEqual(["Quiet"]);
    });
  });

  it("returns an empty conversation for a video with no comments", async () => {
    const v = await video();
    expect(await listComments(db, v.id)).toEqual({ threads: [], total: 0, hasMore: false });
  });
});
