/**
 * Admin analytics against a real Postgres. Runs only when TEST_DATABASE_URL
 * points at a disposable database (tables are truncated).
 */
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { coachUsage, community, courseActivity, learning, membership, parseRange, rangeDays, rangeEndingAt, revenue, signups, topVideos, viewing } from "./service";

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-21T15:00:00Z");
const daysAgo = (d: number, hour = 12) => new Date(Date.UTC(2026, 10, 21 - d, hour));

describe("ranges", () => {
  it("covers the last N UTC days through today, with the previous N before it", () => {
    const range = rangeEndingAt(NOW, 7);
    expect(range.start.toISOString()).toBe("2026-11-15T00:00:00.000Z");
    expect(range.previousStart.toISOString()).toBe("2026-11-08T00:00:00.000Z");
    expect(rangeDays(range)).toEqual(["2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21"]);
  });

  it("accepts only the offered ranges", () => {
    expect(parseRange("90")).toBe(90);
    expect(parseRange("12")).toBe(30);
    expect(parseRange(undefined)).toBe(30);
  });
});

describe.skipIf(!url)("analytics (Postgres)", () => {
  let client: postgres.Sql;
  let db: Database;
  const range = rangeEndingAt(NOW, 7);

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
      sql`truncate coach_conversations, subscriptions, revenue_ledger, watch_sessions, ratings, comments, certificates, quiz_attempts, quizzes, lessons, course_modules, courses, content_reports, creator_applications, videos, "user" cascade`,
    );
  });

  async function person(id: string, createdAt: Date, role: "user" | "creator" | "admin" = "user") {
    await db.insert(schema.user).values({ id, name: id, email: `${id}@test.dev`, role, createdAt });
  }

  async function sub(userId: string, plan: "monthly" | "annual" | "gift", status: schema.SubscriptionStatus, createdAt: Date, currentPeriodEnd: Date, extra: Partial<typeof schema.subscriptions.$inferInsert> = {}) {
    await db.insert(schema.subscriptions).values({ userId, plan, status, createdAt, updatedAt: extra.updatedAt ?? createdAt, currentPeriodEnd, ...extra });
  }

  it("counts members now, by plan, over time, and what started and ended", async () => {
    for (const id of ["a", "b", "c", "d", "e", "f"]) await person(id, daysAgo(60));
    await sub("a", "monthly", "active", daysAgo(40), daysAgo(-10));
    await sub("b", "annual", "active", daysAgo(3), daysAgo(-362), { cancelAtPeriodEnd: true });
    await sub("c", "gift", "active", daysAgo(20), daysAgo(-10));
    // Canceled two days ago: a member until then.
    await sub("d", "monthly", "canceled", daysAgo(30), daysAgo(-5), { updatedAt: daysAgo(2) });
    // Checkout never completed: never a member.
    await sub("e", "monthly", "incomplete_expired", daysAgo(5), daysAgo(-25));
    // Ended in the previous range.
    await sub("f", "monthly", "canceled", daysAgo(50), daysAgo(9), { updatedAt: daysAgo(9) });

    const m = await membership(db, range);
    expect(m.active).toBe(3);
    expect(m.plans).toEqual({ monthly: 1, annual: 1, gift: 1 });
    expect(m.mrrCents).toBe(1900 + Math.round(19900 / 12));
    expect({ renewing: m.renewing, cancelling: m.cancelling }).toEqual({ renewing: 1, cancelling: 1 });
    expect(m.started).toEqual({ current: 1, previous: 0 });
    expect(m.ended).toEqual({ current: 1, previous: 1 });
    expect(m.activeAtStart).toBe(3); // a, c, d
    expect(m.churnRate).toBeCloseTo(1 / 3);
    expect(m.daily.map((d) => d.value)).toEqual([3, 3, 3, 4, 3, 3, 3]);
  });

  it("totals revenue by range and month, with the creator pool's share", async () => {
    await person("a", daysAgo(60));
    const entry = (id: string, kind: "subscription_invoice" | "gift", amountCents: number, occurredAt: Date) =>
      db.insert(schema.revenueLedger).values({ kind, stripeObjectId: id, amountCents, occurredAt, userId: "a" });
    await entry("in_1", "subscription_invoice", 19_00, daysAgo(1));
    await entry("cs_1", "gift", 199_00, daysAgo(2));
    await entry("in_2", "subscription_invoice", 19_00, daysAgo(10));
    await entry("in_3", "subscription_invoice", 19_00, new Date("2026-10-15T00:00:00Z"));

    const r = await revenue(db, range);
    expect(r.totalCents).toEqual({ current: 218_00, previous: 19_00 });
    expect(r.giftCents).toBe(199_00);
    expect(r.creatorPoolCents).toBe(54_50);
    expect(r.monthly).toHaveLength(12);
    expect(r.monthly.at(-1)).toEqual({ month: "2026-11", subscriptionsCents: 38_00, giftsCents: 199_00, totalCents: 237_00 });
    expect(r.monthly.at(-2)).toMatchObject({ month: "2026-10", totalCents: 19_00 });
    expect(r.monthly[0]!.month).toBe("2025-12");
  });

  it("counts sign-ups per day and how many became members", async () => {
    await person("old", daysAgo(10));
    await person("new1", daysAgo(0, 9));
    await person("new2", daysAgo(0, 10));
    await person("new3", daysAgo(4));
    await sub("new1", "monthly", "active", daysAgo(0, 11), daysAgo(-30));
    await sub("new3", "monthly", "incomplete", daysAgo(4), daysAgo(-30));

    const s = await signups(db, range);
    expect(s.count).toEqual({ current: 3, previous: 1 });
    expect(s.becameMembers).toBe(1);
    expect(s.conversionRate).toBeCloseTo(1 / 3);
    expect(s.daily.map((d) => d.value)).toEqual([0, 0, 1, 0, 0, 0, 2]);
  });

  async function content() {
    await person("fellow", daysAgo(90), "creator");
    await person("viewer", daysAgo(90));
    const [community] = await db
      .insert(schema.videos)
      .values({ type: "community", status: "approved", creatorId: "fellow", title: "Bedtime", requireSignedUrls: false, publishedAt: daysAgo(2), ratingAverage: "4.50", ratingCount: 2 })
      .returning();
    const [lesson] = await db
      .insert(schema.videos)
      .values({ type: "professional", status: "approved", creatorId: "fellow", title: "Lesson 1", requireSignedUrls: true, publishedAt: daysAgo(30) })
      .returning();
    await db.insert(schema.videos).values({ type: "community", status: "pending_review", creatorId: "fellow", title: "Queued", requireSignedUrls: false });
    const watch = (videoId: string, userId: string | null, secondsWatched: number, startedAt: Date) =>
      db.insert(schema.watchSessions).values({ videoId, userId, secondsWatched, startedAt });
    await watch(community!.id, "viewer", 120, daysAgo(1));
    await watch(community!.id, null, 45, daysAgo(1));
    await watch(community!.id, null, 10, daysAgo(1)); // under 30s: not a view
    await watch(lesson!.id, "viewer", 600, daysAgo(0, 8));
    await watch(lesson!.id, "viewer", 300, daysAgo(10)); // previous range
    return { community: community!, lesson: lesson! };
  }

  it("counts views, watch time and viewers, and ranks videos", async () => {
    const { community: video } = await content();
    const v = await viewing(db, range);
    expect(v.views).toEqual({ current: 3, previous: 1 });
    expect(v.watchSeconds).toEqual({ current: 775, previous: 300 });
    expect({ academy: v.academyViews, community: v.communityViews, viewers: v.signedInViewers, anonymous: v.anonymousViews }).toEqual({
      academy: 1,
      community: 2,
      viewers: 1,
      anonymous: 1,
    });
    expect(v.daily.map((d) => d.value)).toEqual([0, 0, 0, 0, 0, 2, 1]);

    const top = await topVideos(db, range);
    expect(top.map((t) => [t.title, t.type, t.creator, t.views, t.watchSeconds])).toEqual([
      ["Bedtime", "community", "fellow", 2, 175],
      ["Lesson 1", "professional", "fellow", 1, 600],
    ]);
    expect(top[0]!.id).toBe(video.id);
  });

  it("reports course learners, certificates and quiz results", async () => {
    const { lesson } = await content();
    const [course] = await db.insert(schema.courses).values({ slug: "presence", title: "Presence", published: true }).returning();
    await db.insert(schema.courses).values({ slug: "draft", title: "Draft", published: false });
    const [mod] = await db.insert(schema.courseModules).values({ courseId: course!.id, title: "M1", position: 1 }).returning();
    const [l] = await db.insert(schema.lessons).values({ moduleId: mod!.id, videoId: lesson.id, title: "L1", position: 1 }).returning();
    await db.insert(schema.certificates).values([
      { userId: "viewer", courseId: course!.id, code: "FS-AAAA-BBBB", recipientName: "V", courseTitle: "Presence", issuedAt: daysAgo(0) },
      { userId: "fellow", courseId: course!.id, code: "FS-CCCC-DDDD", recipientName: "F", courseTitle: "Presence", issuedAt: daysAgo(12), revokedAt: daysAgo(11) },
    ]);
    const [quiz] = await db.insert(schema.quizzes).values({ lessonId: l!.id, published: true }).returning();
    await db.insert(schema.quizAttempts).values([
      { quizId: quiz!.id, userId: "viewer", answers: {}, scorePercent: 50, passed: false, createdAt: daysAgo(1) },
      { quizId: quiz!.id, userId: "viewer", answers: {}, scorePercent: 100, passed: true, createdAt: daysAgo(0) },
    ]);

    expect(await courseActivity(db, range)).toEqual([
      { id: course!.id, title: "Presence", slug: "presence", learners: 1, certificates: 1, certificatesAllTime: 1 },
    ]);
    expect(await learning(db, range)).toEqual({ quizAttempts: 2, quizPassRate: 0.5, certificates: { current: 1, previous: 0 } });
  });

  it("counts coach use without reading it", async () => {
    await person("a", daysAgo(30));
    await person("b", daysAgo(30));
    const [c1, c2, old] = await db
      .insert(schema.coachConversations)
      .values([{ userId: "a", title: "x" }, { userId: "b", title: "y" }, { userId: "b", title: "z" }])
      .returning();
    const msg = (conversationId: string, userId: string, role: "user" | "assistant", createdAt: Date, outputTokens?: number) => ({ conversationId, userId, role, content: "private", createdAt, outputTokens });
    await db.insert(schema.coachMessages).values([
      msg(c1!.id, "a", "user", daysAgo(1)),
      msg(c1!.id, "a", "assistant", daysAgo(1), 300),
      msg(c1!.id, "a", "user", daysAgo(1)),
      msg(c2!.id, "b", "user", daysAgo(2)),
      msg(c2!.id, "b", "assistant", daysAgo(2), 200),
      msg(old!.id, "b", "user", daysAgo(20)),
    ]);
    expect(await coachUsage(db, range)).toEqual({ members: 2, messages: 3, conversations: 2, outputTokens: 500 });
  });

  it("counts community activity and what's waiting on admins", async () => {
    const { community: video } = await content();
    await db.insert(schema.comments).values([
      { videoId: video.id, userId: "viewer", body: "Thank you", createdAt: daysAgo(1) },
      { videoId: video.id, userId: "viewer", body: "deleted", status: "removed", createdAt: daysAgo(1) },
    ]);
    await db.insert(schema.ratings).values({ videoId: video.id, userId: "viewer", stars: 5, review: "Great", createdAt: daysAgo(1) });
    await db.insert(schema.contentReports).values({ videoId: video.id, reporterId: "viewer", reason: "spam" });
    await db.insert(schema.creatorApplications).values({ userId: "viewer", statement: "I'd like to share." });

    expect(await community(db, range)).toEqual({
      comments: 1,
      ratings: 1,
      writtenReviews: 1,
      communityVideosPublished: 1,
      academyVideosPublished: 0,
      awaitingReview: 1,
      openReports: 1,
      fellows: 1,
      pendingApplications: 1,
    });
  });
});
