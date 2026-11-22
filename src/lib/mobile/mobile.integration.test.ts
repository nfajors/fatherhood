/**
 * Offline downloads and the app's screens against a real Postgres. Runs only
 * when TEST_DATABASE_URL points at a disposable database (tables are truncated).
 */
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { loadViewer } from "@/lib/playback/access";
import { courseView, homeView, meView } from "./api";
import { checkLicenses, releaseDownload, requestDownload, syncOfflineProgress, type DownloadGateway } from "./downloads";
import { MOBILE_POLICY } from "./policy";

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-22T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

describe.skipIf(!url)("mobile (Postgres)", () => {
  let client: postgres.Sql;
  let db: Database;
  let lessonVideoId: string;
  let previewVideoId: string;
  let storyId: string;
  let prepared: Array<"ready" | "inprogress" | "error">;
  const prepareCalls: string[] = [];
  const gateway: DownloadGateway = {
    prepare: async (uid) => {
      prepareCalls.push(uid);
      return { status: prepared.shift() ?? "ready", percentComplete: 37.4 };
    },
    signedUrl: async (uid, ttl) => `https://dl.test/${uid}?ttl=${ttl}`,
  };
  const viewer = async (id: string) => {
    const u = await db.query.user.findFirst({ where: eq(schema.user.id, id) });
    return loadViewer(db, { id: u!.id, email: u!.email, name: u!.name, role: u!.role, stripeCustomerId: null });
  };

  beforeAll(async () => {
    client = postgres(url!, { max: 4, onnotice: () => {} });
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: "drizzle" });
  });

  afterAll(async () => {
    await client?.end();
  });

  beforeEach(async () => {
    prepared = [];
    prepareCalls.length = 0;
    await db.execute(sql`truncate offline_licenses, watch_progress, learning_paths, lessons, course_modules, courses, subscriptions, videos, "user" cascade`);
    await db.insert(schema.user).values([
      { id: "member", name: "Marcus Lee", email: "marcus@test.dev" },
      { id: "visitor", name: "Sam Cole", email: "sam@test.dev" },
      { id: "fellow", name: "James Hill", email: "james@test.dev", role: "creator" },
    ]);
    await db.insert(schema.subscriptions).values({
      userId: "member",
      plan: "annual",
      status: "active",
      stripeSubscriptionId: "sub_1",
      currentPeriodEnd: new Date("2027-06-01T00:00:00Z"),
    });
    const [lesson, preview, story, pending] = await db
      .insert(schema.videos)
      .values([
        { type: "professional", status: "approved", creatorId: "fellow", title: "Bedtime", cloudflareUid: "uid-lesson", durationSeconds: 600, requireSignedUrls: true },
        { type: "professional", status: "approved", creatorId: "fellow", title: "Welcome", cloudflareUid: "uid-preview", durationSeconds: 120, requireSignedUrls: true },
        { type: "community", status: "approved", creatorId: "fellow", title: "My dad", cloudflareUid: "uid-story", durationSeconds: 300, requireSignedUrls: false },
        { type: "community", status: "pending_review", creatorId: "fellow", title: "Draft", cloudflareUid: "uid-pending", requireSignedUrls: false },
      ])
      .returning();
    lessonVideoId = lesson!.id;
    previewVideoId = preview!.id;
    storyId = story!.id;
    expect(pending).toBeTruthy();
    const [course] = await db.insert(schema.courses).values({ slug: "presence", title: "Presence", published: true }).returning();
    const [mod] = await db.insert(schema.courseModules).values({ courseId: course!.id, title: "Evenings", position: 1 }).returning();
    await db.insert(schema.lessons).values([
      { moduleId: mod!.id, videoId: preview!.id, title: "Welcome", position: 1, isPreview: true },
      { moduleId: mod!.id, videoId: lesson!.id, title: "Bedtime without the battle", position: 2 },
    ]);
  });

  describe("downloads", () => {
    it("asks Stream for the MP4 once, then gives a signed link and a 30-day license", async () => {
      prepared = ["inprogress"];
      expect(await requestDownload(db, gateway, { viewer: await viewer("member"), videoId: lessonVideoId, now: NOW })).toEqual({
        status: "preparing",
        percentComplete: 37,
      });
      expect(await db.$count(schema.offlineLicenses)).toBe(0);

      const ready = await requestDownload(db, gateway, { viewer: await viewer("member"), videoId: lessonVideoId, now: NOW });
      expect(ready).toEqual({
        status: "ready",
        url: `https://dl.test/uid-lesson?ttl=${MOBILE_POLICY.downloadUrlTtlSeconds}`,
        urlExpiresAt: new Date(NOW.getTime() + MOBILE_POLICY.downloadUrlTtlSeconds * 1000).toISOString(),
        licenseExpiresAt: new Date(NOW.getTime() + 30 * DAY).toISOString(),
      });
      expect((await db.query.videos.findFirst({ where: eq(schema.videos.id, lessonVideoId) }))!.downloadReadyAt).toEqual(NOW);

      // Once ready, Stream isn't asked again.
      await requestDownload(db, gateway, { viewer: await viewer("member"), videoId: lessonVideoId, now: NOW });
      expect(prepareCalls).toEqual(["uid-lesson", "uid-lesson"]);
      expect(await db.$count(schema.offlineLicenses)).toBe(1);
    });

    it("is for members only, for published videos only", async () => {
      await expect(requestDownload(db, gateway, { viewer: await viewer("visitor"), videoId: storyId, now: NOW })).rejects.toMatchObject({ reason: "membership_required" });
      await expect(requestDownload(db, gateway, { viewer: await viewer("visitor"), videoId: previewVideoId, now: NOW })).rejects.toMatchObject({ reason: "membership_required" });
      const [pending] = await db.select().from(schema.videos).where(eq(schema.videos.status, "pending_review"));
      await expect(requestDownload(db, gateway, { viewer: await viewer("fellow"), videoId: pending!.id, now: NOW })).rejects.toMatchObject({ reason: "not_found" });
      await expect(requestDownload(db, gateway, { viewer: await viewer("member"), videoId: pending!.id, now: NOW })).rejects.toMatchObject({ reason: "not_found" });
      expect(prepareCalls).toEqual([]);
    });

    it("stops at the download limit, counting only licenses still running", async () => {
      const extra = await db
        .insert(schema.videos)
        .values(Array.from({ length: MOBILE_POLICY.maxOfflineDownloads }, (_, i) => ({ type: "community" as const, status: "approved" as const, creatorId: "fellow", title: `S${i}`, cloudflareUid: `u${i}`, requireSignedUrls: false })))
        .returning({ id: schema.videos.id });
      await db.insert(schema.offlineLicenses).values(extra.map((v) => ({ userId: "member", videoId: v.id, expiresAt: new Date(NOW.getTime() + DAY) })));
      await expect(requestDownload(db, gateway, { viewer: await viewer("member"), videoId: storyId, now: NOW })).rejects.toMatchObject({ reason: "limit_reached" });
      // Renewing one he already holds is fine.
      expect(await requestDownload(db, gateway, { viewer: await viewer("member"), videoId: extra[0]!.id, now: NOW })).toMatchObject({ status: "ready" });

      await db.update(schema.offlineLicenses).set({ expiresAt: new Date(NOW.getTime() - DAY) }).where(eq(schema.offlineLicenses.videoId, extra[1]!.id));
      expect(await requestDownload(db, gateway, { viewer: await viewer("member"), videoId: storyId, now: NOW })).toMatchObject({ status: "ready" });
    });

    it("reports a video Stream can't convert", async () => {
      prepared = ["error"];
      await expect(requestDownload(db, gateway, { viewer: await viewer("member"), videoId: storyId, now: NOW })).rejects.toMatchObject({ reason: "failed" });
    });

    it("renews licenses while he's a member, and revokes them when that ends or the video is withdrawn", async () => {
      for (const videoId of [lessonVideoId, storyId]) await requestDownload(db, gateway, { viewer: await viewer("member"), videoId, now: NOW });
      const later = new Date(NOW.getTime() + 10 * DAY);
      const never = "00000000-0000-4000-8000-000000000000";
      expect(await checkLicenses(db, { viewer: await viewer("member"), videoIds: [lessonVideoId, storyId, never], now: later })).toEqual([
        { videoId: lessonVideoId, status: "valid", licenseExpiresAt: new Date(later.getTime() + 30 * DAY).toISOString() },
        { videoId: storyId, status: "valid", licenseExpiresAt: new Date(later.getTime() + 30 * DAY).toISOString() },
        { videoId: never, status: "revoked" },
      ]);

      await db.update(schema.videos).set({ status: "unpublished" }).where(eq(schema.videos.id, storyId));
      expect((await checkLicenses(db, { viewer: await viewer("member"), videoIds: [lessonVideoId, storyId], now: later })).map((l) => l.status)).toEqual(["valid", "revoked"]);

      await db.update(schema.subscriptions).set({ status: "canceled" });
      expect((await checkLicenses(db, { viewer: await viewer("member"), videoIds: [lessonVideoId], now: later })).map((l) => l.status)).toEqual(["revoked"]);
      expect(await db.$count(schema.offlineLicenses)).toBe(0);
    });

    it("frees the slot when he removes a download", async () => {
      await requestDownload(db, gateway, { viewer: await viewer("member"), videoId: storyId, now: NOW });
      await releaseDownload(db, "member", storyId);
      expect(await db.$count(schema.offlineLicenses)).toBe(0);
    });
  });

  describe("offline progress", () => {
    it("saves his place for licensed videos; the newest record wins and completion sticks", async () => {
      await requestDownload(db, gateway, { viewer: await viewer("member"), videoId: lessonVideoId, now: NOW });
      const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
      const saved = await syncOfflineProgress(
        db,
        "member",
        [
          { videoId: lessonVideoId, positionSeconds: 200, completed: false, recordedAt: at(10) },
          { videoId: lessonVideoId, positionSeconds: 9_999, completed: true, recordedAt: at(20) },
          { videoId: storyId, positionSeconds: 50, completed: false, recordedAt: at(20) }, // not downloaded
        ],
        at(60),
      );
      expect(saved).toBe(1);
      const progress = () => db.query.watchProgress.findFirst({ where: and(eq(schema.watchProgress.userId, "member"), eq(schema.watchProgress.videoId, lessonVideoId)) });
      expect(await progress()).toMatchObject({ positionSeconds: 600, completed: true, updatedAt: at(20) });

      // A record older than what the server has (say, from his other phone) changes nothing.
      expect(await syncOfflineProgress(db, "member", [{ videoId: lessonVideoId, positionSeconds: 5, completed: false, recordedAt: at(15) }], at(60))).toBe(0);
      // A newer rewatch moves his place but keeps it completed.
      await syncOfflineProgress(db, "member", [{ videoId: lessonVideoId, positionSeconds: 30, completed: false, recordedAt: at(30) }], at(60));
      expect(await progress()).toMatchObject({ positionSeconds: 30, completed: true });
      // No views are counted offline.
      expect((await db.query.videos.findFirst({ where: eq(schema.videos.id, lessonVideoId) }))!.viewCount).toBe(0);
    });

    it("doesn't take a record from the future", async () => {
      await requestDownload(db, gateway, { viewer: await viewer("member"), videoId: storyId, now: NOW });
      await syncOfflineProgress(db, "member", [{ videoId: storyId, positionSeconds: 40, completed: false, recordedAt: new Date(NOW.getTime() + 365 * DAY) }], NOW);
      expect((await db.query.watchProgress.findFirst({ where: eq(schema.watchProgress.videoId, storyId) }))!.updatedAt).toEqual(NOW);
    });
  });

  describe("screens", () => {
    it("says who he is and whether he's a member, without prices", async () => {
      const me = meView({ id: "member", name: "Marcus Lee", email: "marcus@test.dev" }, await viewer("member"), NOW);
      expect(me).toMatchObject({ member: true, memberUntil: "2027-06-01T00:00:00.000Z", offline: { licenseDays: 30 } });
      expect(meView({ id: "visitor", name: "Sam", email: "sam@test.dev" }, await viewer("visitor"), NOW)).toMatchObject({ member: false, memberUntil: null });
      expect(JSON.stringify(me)).not.toMatch(/price|\$|usd/i);
    });

    it("marks lessons that are for members, and opens continue-watching in the app", async () => {
      const outline = await courseView(db, "presence", "visitor", false);
      expect(outline!.modules[0]!.lessons.map((l) => [l.title, l.videoId, l.locked])).toEqual([
        ["Welcome", previewVideoId, false],
        ["Bedtime without the battle", lessonVideoId, true],
      ]);
      expect((await courseView(db, "presence", "member", true))!.modules[0]!.lessons.every((l) => !l.locked)).toBe(true);

      await db.insert(schema.watchProgress).values({ userId: "member", videoId: lessonVideoId, positionSeconds: 90 });
      const home = await homeView(db, "member");
      expect(home.continueWatching).toEqual([
        expect.objectContaining({ videoId: lessonVideoId, positionSeconds: 90, target: expect.objectContaining({ kind: "lesson", courseSlug: "presence" }) }),
      ]);
      expect(home.courses.map((c) => c.slug)).toEqual(["presence"]);
      expect(home.trending.map((v) => v.id)).toEqual([storyId]);
    });
  });
});
