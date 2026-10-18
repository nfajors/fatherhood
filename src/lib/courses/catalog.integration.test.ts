/**
 * Course building, catalog queries and watch tracking against a real Postgres.
 * Runs only when TEST_DATABASE_URL points at a disposable database (tables are
 * truncated).
 */
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { accessFor, loadViewer } from "@/lib/playback/access";
import { PlaybackError, recordHeartbeat, setCompleted } from "@/lib/playback/service";
import {
  addLesson,
  addModule,
  CourseError,
  createCourse,
  deleteModule,
  moveLesson,
  moveModule,
  setPublished,
  updateCourse,
  updateLesson,
} from "./admin";
import {
  communityThemes,
  continueWatching,
  coursesInProgress,
  getCommunityVideo,
  getCourseOutline,
  lessonNavigation,
  listCommunityVideos,
  listPublishedCourses,
  relatedCommunityVideos,
} from "./catalog";

const url = process.env.TEST_DATABASE_URL;
const T0 = new Date("2026-10-17T12:00:00Z");
const at = (s: number) => new Date(T0.getTime() + s * 1000);

describe.skipIf(!url)("courses and playback (Postgres)", () => {
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
    await db.execute(sql`truncate watch_sessions, watch_progress, theme_assignments, themes, lessons, course_modules, courses, subscriptions, videos, "user" cascade`);
    await db.insert(schema.user).values([
      { id: "author", name: "The Author", email: "author@test.dev", role: "admin" },
      { id: "fellow", name: "James", email: "james@test.dev", role: "creator" },
      { id: "member", name: "Member", email: "member@test.dev" },
      { id: "visitor", name: "Visitor", email: "visitor@test.dev" },
    ]);
    await db.insert(schema.subscriptions).values({ userId: "member", plan: "annual", status: "active", currentPeriodEnd: new Date("2030-01-01") });
  });

  let n = 0;
  async function video(overrides: Partial<typeof schema.videos.$inferInsert> = {}) {
    n++;
    const [row] = await db
      .insert(schema.videos)
      .values({
        type: "professional",
        status: "approved",
        creatorId: "author",
        title: `Video ${n}`,
        cloudflareUid: `cf${n}`,
        durationSeconds: 600,
        requireSignedUrls: true,
        publishedAt: at(n),
        ...overrides,
      })
      .returning();
    return row!;
  }

  /** A published course: two modules, three lessons, the first a free preview. */
  async function sampleCourse() {
    const [v1, v2, v3] = [await video(), await video(), await video()];
    const course = await createCourse(db, { title: "Why Fathers Matter", category: "Research", instructorId: "author" });
    const m1 = await addModule(db, course.id, "The evidence");
    const m2 = await addModule(db, course.id, "What it means for you");
    const l1 = await addLesson(db, m1.id, { title: "The phone call", videoId: v1.id, isPreview: true });
    const l2 = await addLesson(db, m1.id, { title: "Fragile Families", videoId: v2.id });
    const l3 = await addLesson(db, m2.id, { title: "Your turn", videoId: v3.id });
    await setPublished(db, course.id, true, T0);
    return { course, modules: [m1, m2], lessons: [l1, l2, l3], videos: [v1, v2, v3] };
  }

  describe("course builder", () => {
    it("creates courses with clean, unique addresses", async () => {
      const course = await createCourse(db, { title: "Why Fathers Matter!" });
      expect(course).toMatchObject({ slug: "why-fathers-matter", published: false });
      await expect(createCourse(db, { title: "Why fathers matter" })).rejects.toMatchObject({ reason: "slug_taken" });
      const other = await createCourse(db, { title: "Presence" });
      await expect(updateCourse(db, other.id, { slug: "Why Fathers Matter" })).rejects.toMatchObject({ reason: "slug_taken" });
      expect(await updateCourse(db, other.id, { slug: "Being Present" })).toMatchObject({ slug: "being-present" });
    });

    it("orders modules and lessons and moves them", async () => {
      const course = await createCourse(db, { title: "Course" });
      const [a, b, c] = [await addModule(db, course.id, "A"), await addModule(db, course.id, "B"), await addModule(db, course.id, "C")];
      expect([a.position, b.position, c.position]).toEqual([1, 2, 3]);
      expect(await moveModule(db, c.id, "up")).toBe(true);
      expect(await moveModule(db, a.id, "up")).toBe(false); // already first
      const order = await db.select({ title: schema.courseModules.title }).from(schema.courseModules).orderBy(schema.courseModules.position);
      expect(order.map((m) => m.title)).toEqual(["A", "C", "B"]);

      const l1 = await addLesson(db, a.id, { title: "One" });
      const l2 = await addLesson(db, a.id, { title: "Two" });
      await moveLesson(db, l2.id, "up");
      const lessonOrder = await db.select({ title: schema.lessons.title }).from(schema.lessons).orderBy(schema.lessons.position);
      expect(lessonOrder.map((l) => l.title)).toEqual(["Two", "One"]);
      expect(await moveLesson(db, l1.id, "down")).toBe(false);

      await deleteModule(db, a.id);
      expect(await db.$count(schema.lessons)).toBe(0);
    });

    it("only attaches professional videos to lessons", async () => {
      const course = await createCourse(db, { title: "Course" });
      const mod = await addModule(db, course.id, "M");
      const community = await video({ type: "community", requireSignedUrls: false });
      await expect(addLesson(db, mod.id, { title: "x", videoId: community.id })).rejects.toMatchObject({ reason: "invalid_video" });
    });

    it("publishes only when every lesson has an approved professional video", async () => {
      const course = await createCourse(db, { title: "Course" });
      await expect(setPublished(db, course.id, true)).rejects.toThrowError(/at least one lesson/);
      const mod = await addModule(db, course.id, "M");
      const lesson = await addLesson(db, mod.id, { title: "Draft lesson" });
      await expect(setPublished(db, course.id, true)).rejects.toThrowError(/Draft lesson/);
      const pending = await video({ status: "pending_review" });
      await updateLesson(db, lesson.id, { videoId: pending.id });
      await expect(setPublished(db, course.id, true)).rejects.toBeInstanceOf(CourseError);
      await db.update(schema.videos).set({ status: "approved" }).where(eq(schema.videos.id, pending.id));
      expect(await setPublished(db, course.id, true, T0)).toMatchObject({ published: true, publishedAt: T0 });
      // Re-publishing keeps the original date.
      await setPublished(db, course.id, false);
      expect(await setPublished(db, course.id, true, at(999))).toMatchObject({ publishedAt: T0 });
    });
  });

  describe("catalog", () => {
    it("lists published courses with lesson counts, length and the viewer's progress", async () => {
      const { videos } = await sampleCourse();
      await createCourse(db, { title: "Unpublished draft" });
      await setCompleted(db, "member", videos[0]!.id, true);

      const signedOut = await listPublishedCourses(db, null);
      expect(signedOut).toEqual([
        expect.objectContaining({ slug: "why-fathers-matter", lessonCount: 3, totalSeconds: 1800, instructorName: "The Author", percentComplete: null }),
      ]);
      expect((await listPublishedCourses(db, "member"))[0]!.percentComplete).toBe(33);
    });

    it("builds the outline, hiding unpublished courses and flagging unavailable lessons", async () => {
      const { course, lessons, videos } = await sampleCourse();
      await db.update(schema.videos).set({ status: "unpublished" }).where(eq(schema.videos.id, videos[2]!.id));
      await setCompleted(db, "member", videos[0]!.id, true);

      const outline = (await getCourseOutline(db, course.slug, "member"))!;
      expect(outline.modules.map((m) => [m.title, m.lessons.map((l) => l.title)])).toEqual([
        ["The evidence", ["The phone call", "Fragile Families"]],
        ["What it means for you", ["Your turn"]],
      ]);
      expect(outline.flat.map((l) => [l.available, l.completed])).toEqual([
        [true, true],
        [true, false],
        [false, false],
      ]);
      expect(outline.stats).toEqual({ lessonCount: 2, totalSeconds: 1200, completedCount: 1, percentComplete: 50, ratingAverage: null, ratingCount: 0 });
      expect(outline.nextLessonId).toBe(lessons[1]!.id);

      const nav = lessonNavigation(outline, lessons[1]!.id);
      expect(nav).toMatchObject({ moduleTitle: "The evidence", position: 2, count: 2, next: null });
      expect(nav.previous?.id).toBe(lessons[0]!.id);

      await setPublished(db, course.id, false);
      expect(await getCourseOutline(db, course.slug, null)).toBeNull();
      expect(await getCourseOutline(db, course.slug, null, { includeUnpublished: true })).not.toBeNull();
    });

    it("opens preview lessons to everyone and the rest to members", async () => {
      const { videos } = await sampleCourse();
      const [preview, paid] = [videos[0]!, videos[1]!];
      const member = await loadViewer(db, { id: "member", email: "", name: "", role: "user", stripeCustomerId: null });
      const visitor = await loadViewer(db, { id: "visitor", email: "", name: "", role: "user", stripeCustomerId: null });
      expect(await accessFor(db, preview, null)).toEqual({ allowed: true, signed: true });
      expect(await accessFor(db, paid, null)).toEqual({ allowed: false, reason: "sign_in_required" });
      expect(await accessFor(db, paid, visitor)).toEqual({ allowed: false, reason: "membership_required" });
      expect(await accessFor(db, paid, member)).toEqual({ allowed: true, signed: true });
    });

    it("keeps a preview in an unpublished course members-only", async () => {
      const { course, videos } = await sampleCourse();
      await setPublished(db, course.id, false);
      expect(await accessFor(db, videos[0]!, null)).toEqual({ allowed: false, reason: "sign_in_required" });
    });

    it("lists Community videos by theme, with related videos and paging", async () => {
      const [theme] = await db.insert(schema.themes).values({ slug: "presence", name: "Presence", description: "d", status: "active", origin: "book" }).returning();
      const a = await video({ type: "community", creatorId: "fellow", requireSignedUrls: false });
      const b = await video({ type: "community", creatorId: "fellow", requireSignedUrls: false });
      await video({ type: "community", creatorId: "fellow", requireSignedUrls: false });
      await video({ type: "community", creatorId: "fellow", status: "pending_review", requireSignedUrls: false });
      await db.insert(schema.themeAssignments).values([
        { themeId: theme!.id, videoId: a.id, source: "ai", isPrimary: true },
        { themeId: theme!.id, videoId: b.id, source: "ai" },
      ]);

      expect((await listCommunityVideos(db)).total).toBe(3);
      const filtered = await listCommunityVideos(db, { themeSlug: "presence" });
      expect(filtered.videos.map((v) => v.id).sort()).toEqual([a.id, b.id].sort());
      expect((await listCommunityVideos(db, { limit: 2, offset: 2 })).videos).toHaveLength(1);
      expect(await communityThemes(db)).toEqual([{ slug: "presence", name: "Presence", count: 2 }]);

      const found = (await getCommunityVideo(db, a.id))!;
      expect(found).toMatchObject({ creatorName: "James", themes: [expect.objectContaining({ slug: "presence" })] });
      expect((await relatedCommunityVideos(db, a.id, [theme!.id])).map((v) => v.id)).toEqual([b.id]);
    });
  });

  describe("watch tracking", () => {
    it("starts a session, credits real watch time and counts one view", async () => {
      const v = await video({ type: "community", requireSignedUrls: false });
      const first = await recordHeartbeat(db, { videoId: v.id, userId: null, sessionId: null, positionSeconds: 0, watchedSeconds: 0, ended: false }, T0);
      await recordHeartbeat(db, { videoId: v.id, userId: null, sessionId: first.sessionId, positionSeconds: 15, watchedSeconds: 15, ended: false }, at(15));
      // A tampered client claiming 10 minutes in 15 seconds gets 20 at most.
      await recordHeartbeat(db, { videoId: v.id, userId: null, sessionId: first.sessionId, positionSeconds: 30, watchedSeconds: 600, ended: false }, at(30));
      await recordHeartbeat(db, { videoId: v.id, userId: null, sessionId: first.sessionId, positionSeconds: 45, watchedSeconds: 15, ended: false }, at(45));

      const [session] = await db.select().from(schema.watchSessions);
      expect(session).toMatchObject({ secondsWatched: 50, maxPositionSeconds: 45, userId: null });
      expect((await db.query.videos.findFirst({ where: eq(schema.videos.id, v.id) }))!.viewCount).toBe(1);
      expect(await db.$count(schema.watchProgress)).toBe(0); // anonymous viewers have no saved progress
    });

    it("gives creators no views or watch time for their own videos, but keeps their place", async () => {
      const v = await video({ type: "community", creatorId: "fellow", requireSignedUrls: false });
      const s = await recordHeartbeat(db, { videoId: v.id, userId: "fellow", sessionId: null, positionSeconds: 0, watchedSeconds: 0, ended: false }, T0);
      for (const t of [15, 30, 45]) {
        await recordHeartbeat(db, { videoId: v.id, userId: "fellow", sessionId: s.sessionId, positionSeconds: t, watchedSeconds: 15, ended: false }, at(t));
      }
      expect((await db.select().from(schema.watchSessions))[0]).toMatchObject({ secondsWatched: 0, maxPositionSeconds: 45 });
      expect((await db.query.videos.findFirst({ where: eq(schema.videos.id, v.id) }))!.viewCount).toBe(0);
      expect((await db.select().from(schema.watchProgress))[0]).toMatchObject({ userId: "fellow", positionSeconds: 45 });
    });

    it("saves resume position and keeps completion once reached", async () => {
      const v = await video();
      const s = await recordHeartbeat(db, { videoId: v.id, userId: "member", sessionId: null, positionSeconds: 0, watchedSeconds: 0, ended: false }, T0);
      const done = await recordHeartbeat(db, { videoId: v.id, userId: "member", sessionId: s.sessionId, positionSeconds: 560, watchedSeconds: 15, ended: false }, at(15));
      expect(done.completed).toBe(true);
      await recordHeartbeat(db, { videoId: v.id, userId: "member", sessionId: s.sessionId, positionSeconds: 20, watchedSeconds: 15, ended: false }, at(30));
      const [progress] = await db.select().from(schema.watchProgress);
      expect(progress).toMatchObject({ positionSeconds: 20, completed: true });
    });

    it("rejects a session that belongs to another viewer or video", async () => {
      const v = await video();
      const other = await video();
      const s = await recordHeartbeat(db, { videoId: v.id, userId: "member", sessionId: null, positionSeconds: 0, watchedSeconds: 0, ended: false }, T0);
      await expect(
        recordHeartbeat(db, { videoId: v.id, userId: "visitor", sessionId: s.sessionId, positionSeconds: 5, watchedSeconds: 5, ended: false }, at(5)),
      ).rejects.toBeInstanceOf(PlaybackError);
      await expect(
        recordHeartbeat(db, { videoId: other.id, userId: "member", sessionId: s.sessionId, positionSeconds: 5, watchedSeconds: 5, ended: false }, at(5)),
      ).rejects.toBeInstanceOf(PlaybackError);
    });

    it("feeds My Learning: unfinished videos and courses in progress", async () => {
      const { course, lessons, videos } = await sampleCourse();
      const story = await video({ type: "community", creatorId: "fellow", requireSignedUrls: false, title: "A story" });
      const beat = (videoId: string, position: number, when: Date) =>
        recordHeartbeat(db, { videoId, userId: "member", sessionId: null, positionSeconds: position, watchedSeconds: 0, ended: false }, when);
      await beat(videos[1]!.id, 120, at(10));
      await beat(story.id, 60, at(20));
      await beat(videos[0]!.id, 600, at(30)); // finished: not "continue watching"

      const items = await continueWatching(db, "member");
      expect(items.map((i) => [i.title, i.href, i.context])).toEqual([
        ["A story", `/community/${story.id}`, "Community Voices"],
        ["Fragile Families", `/academy/${course.slug}/${lessons[1]!.id}`, "Why Fathers Matter"],
      ]);
      expect((await coursesInProgress(db, "member")).map((c) => [c.slug, c.percentComplete])).toEqual([[course.slug, 33]]);

      await setPublished(db, course.id, false);
      expect((await continueWatching(db, "member")).map((i) => i.title)).toEqual(["A story"]);
    });
  });
});
