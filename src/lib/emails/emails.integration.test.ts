/**
 * Email sequences, reply notifications and preferences against a real
 * Postgres. Runs only when TEST_DATABASE_URL points at a disposable database
 * (tables are truncated).
 */
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "@/lib/auth";
import { moderateComment, postComment } from "@/lib/comments/service";
import { addLesson, addModule, createCourse, setPublished } from "@/lib/courses/admin";
import type { Database } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import type { EmailMessage, Mailer } from "@/lib/email";
import { runEmailSequences } from "./engine";
import { getPreferences, unsubscribe, updatePreferences } from "./preferences";
import { notifyReply } from "./replies";
import { verifyEmailToken } from "./tokens";

const url = process.env.TEST_DATABASE_URL;
const T0 = new Date("2026-10-18T12:00:00Z");
const hours = (h: number) => new Date(T0.getTime() + h * 3_600_000);
const days = (d: number) => hours(d * 24);
const APP = "https://fatherhood.school";
const person = (id: string): SessionUser => ({ id, role: "user", email: `${id}@test.dev`, name: id, stripeCustomerId: null });

class FakeMailer implements Mailer {
  sent: EmailMessage[] = [];
  failures = 0;
  async send(message: EmailMessage) {
    if (this.failures > 0) {
      this.failures--;
      throw new Error("Resend is down");
    }
    this.sent.push(message);
  }
  subjects() {
    return this.sent.map((m) => `${m.to}: ${m.subject}`);
  }
}

describe.skipIf(!url)("email sequences (Postgres)", () => {
  let client: postgres.Sql;
  let db: Database;
  let mailer: FakeMailer;

  beforeAll(async () => {
    process.env.EMAIL_TOKEN_SECRET = "test-email-secret";
    client = postgres(url!, { max: 4, onnotice: () => {} });
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: "drizzle" });
  });

  afterAll(async () => {
    await client?.end();
  });

  beforeEach(async () => {
    await db.execute(
      sql`truncate email_sends, email_enrollments, email_preferences, comments, watch_sessions, watch_progress, collection_items, collections, lessons, course_modules, courses, subscriptions, videos, "user" cascade`,
    );
    mailer = new FakeMailer();
    await db.insert(schema.user).values({ id: "author", name: "The Author", email: "author@test.dev", role: "admin", createdAt: days(-400) });
  });

  const run = (now: Date) => runEmailSequences(db, mailer, { appUrl: APP, postalAddress: "1 Main St", now });

  async function account(id: string, name: string, createdAt: Date) {
    await db.insert(schema.user).values({ id, name, email: `${id}@test.dev`, createdAt });
  }
  async function membership(userId: string, startedAt: Date, end: Date, status: "active" | "canceled" = "active") {
    await db.insert(schema.subscriptions).values({ userId, plan: "annual", status, currentPeriodEnd: end, createdAt: startedAt });
  }
  let n = 0;
  async function video(type: "community" | "professional" = "community", title = `Video ${++n}`) {
    const [row] = await db
      .insert(schema.videos)
      .values({ type, status: "approved", creatorId: "author", title, cloudflareUid: `cf${++n}`, durationSeconds: 300, requireSignedUrls: type === "professional", publishedAt: days(-30) })
      .returning();
    return row!;
  }
  async function course(title: string, publishedAt: Date) {
    const c = await createCourse(db, { title });
    const m = await addModule(db, c.id, "M");
    const v = await video("professional", `${title} lesson`);
    const l = await addLesson(db, m.id, { title: `${title} lesson`, videoId: v.id, isPreview: true });
    await setPublished(db, c.id, true, publishedAt);
    return { c, v, l };
  }
  const enrollment = async (userId: string, sequence: string) =>
    (await db.select().from(schema.emailEnrollments).where(sql`${schema.emailEnrollments.userId} = ${userId} and ${schema.emailEnrollments.sequence} = ${sequence}`))[0];

  it("welcomes new accounts over five days, with personalized, unsubscribable emails", async () => {
    await course("Present Fathers", days(-60));
    await video("community", "Bedtime stories that stuck");
    await account("sam", "Sam Jones", hours(-2));
    await account("old", "Old Timer", days(-30));

    const first = await run(T0);
    expect(first.enrolled.welcome).toBe(1);
    expect(mailer.subjects()).toEqual(["sam@test.dev: Welcome to Fatherhood.School"]);
    const message = mailer.sent[0]!;
    expect(message.text).toContain("Welcome, Sam.");
    expect(message.text).toContain("Present Fathers lesson");
    expect(message.text).toContain("1 Main St");
    const token = new URL(message.headers!["List-Unsubscribe"]!.slice(1, -1)).searchParams.get("t");
    expect(verifyEmailToken(token)).toBe("sam");
    expect(message.headers!["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");

    // Nothing more is due until day 2, and re-running never resends.
    await run(hours(1));
    expect(mailer.sent).toHaveLength(1);
    await run(hours(49));
    expect(mailer.sent.at(-1)!.subject).toBe("Short stories from other fathers");
    expect(mailer.sent.at(-1)!.text).toContain("Bedtime stories that stuck");
    await run(hours(121));
    expect(mailer.sent.at(-1)!.subject).toBe("What's inside the Academy");
    expect(await enrollment("sam", "welcome")).toMatchObject({ status: "completed" });
    expect(await db.$count(schema.emailSends, eq(schema.emailSends.status, "sent"))).toBe(3);
    await run(days(10));
    expect(mailer.sent).toHaveLength(3);
  });

  it("moves people who join from welcome to member onboarding", async () => {
    await course("Present Fathers", days(-60));
    await account("sam", "Sam Jones", hours(-2));
    await run(T0);
    await membership("sam", hours(10), days(365));

    const result = await run(hours(49));
    expect(result.enrolled.member_onboarding).toBe(1);
    expect(await enrollment("sam", "welcome")).toMatchObject({ status: "exited", exitReason: "became_member" });
    expect(mailer.subjects()).toEqual(["sam@test.dev: Welcome to Fatherhood.School", "sam@test.dev: Your membership is active"]);
    // Onboarding is timed from when they joined the sequence.
    await run(hours(49 + 72));
    expect(mailer.sent.at(-1)!.subject).toBe("Ten minutes is enough to start");
  });

  it("respects opt-outs: an unsubscribed person leaves the sequence without an email", async () => {
    await account("sam", "Sam Jones", hours(-2));
    await unsubscribe(db, "sam", "learning");
    await run(T0);
    expect(mailer.sent).toEqual([]);
    expect(await enrollment("sam", "welcome")).toMatchObject({ status: "exited", exitReason: "unsubscribed" });
  });

  it("retries a failed send, then gives up on that step", async () => {
    await course("Present Fathers", days(-60));
    await account("sam", "Sam Jones", hours(-2));
    mailer.failures = 3;
    await run(T0);
    expect(await enrollment("sam", "welcome")).toMatchObject({ step: 0, attempts: 1 });
    // Held for the lease (15 minutes) before the retry.
    await run(hours(0.1));
    expect(await enrollment("sam", "welcome")).toMatchObject({ attempts: 1 });
    await run(hours(0.3));
    await run(hours(0.6));
    const row = await enrollment("sam", "welcome");
    expect(row).toMatchObject({ step: 1, attempts: 0 });
    const [send] = await db.select().from(schema.emailSends);
    expect(send).toMatchObject({ status: "failed", error: "Resend is down", step: "start" });
    expect(mailer.sent).toEqual([]);
  });

  it("nudges inactive members at most once a month", async () => {
    await course("Present Fathers", days(-60));
    const story = await video();
    await account("quiet", "Quiet Dad", days(-90));
    await account("busy", "Busy Dad", days(-90));
    await membership("quiet", days(-60), days(300));
    await membership("busy", days(-60), days(300));
    await db.insert(schema.watchProgress).values([
      { userId: "quiet", videoId: story.id, positionSeconds: 30, updatedAt: days(-20) },
      { userId: "busy", videoId: story.id, positionSeconds: 30, updatedAt: days(-1) },
    ]);

    const first = await run(T0);
    expect(first.enrolled.reengagement).toBe(1);
    expect(mailer.subjects()).toEqual([`quiet@test.dev: Still thinking about "${story.title}"?`]);
    await run(days(5));
    expect(mailer.sent).toHaveLength(1);
    // Still quiet a month later: one more nudge (the busy one kept watching).
    await db.update(schema.watchProgress).set({ updatedAt: days(29) }).where(eq(schema.watchProgress.userId, "busy"));
    const later = await run(days(31));
    expect(later.enrolled.reengagement).toBe(1);
    expect(mailer.sent).toHaveLength(2);
    expect(await db.$count(schema.emailSends)).toBe(2);
  });

  it("follows up after a membership ends, and stops if they rejoin", async () => {
    await account("gone", "Gone Dad", days(-200));
    await membership("gone", days(-200), days(-5), "canceled");
    await run(T0);
    expect(mailer.subjects()).toEqual(["gone@test.dev: Your Fatherhood.School membership has ended"]);

    // A new course after they left gives the 30-day email something to say.
    await course("Repair", days(10));
    await run(days(31));
    expect(mailer.sent.at(-1)!.subject).toBe("New at Fatherhood.School since you left");
    expect(mailer.sent.at(-1)!.text).toContain("Repair");
    expect(await enrollment("gone", "winback")).toMatchObject({ status: "completed" });
  });

  it("skips the win-back follow-up when nothing is new, and exits on rejoining", async () => {
    await account("a", "A Dad", days(-200));
    await account("b", "B Dad", days(-200));
    await membership("a", days(-200), days(-5), "canceled");
    await membership("b", days(-200), days(-5), "canceled");
    await run(T0);
    await membership("b", days(2), days(400));
    await run(days(31));
    expect(await enrollment("a", "winback")).toMatchObject({ status: "completed" });
    expect(await enrollment("b", "winback")).toMatchObject({ status: "exited", exitReason: "rejoined" });
    const skipped = await db.select().from(schema.emailSends).where(sql`${schema.emailSends.status} = 'skipped' and ${schema.emailSends.sequence} = 'winback'`);
    expect(skipped.map((s) => s.step)).toEqual(["whats-new"]);
    expect(mailer.sent).toHaveLength(2);
  });

  describe("reply notifications", () => {
    beforeEach(async () => {
      for (const id of ["ann", "ben", "cal"]) await account(id, `${id[0]!.toUpperCase()}${id.slice(1)} Smith`, days(-10));
    });

    it("tells the conversation's starter, at most once per window", async () => {
      const v = await video("community", "Bedtime");
      const root = await postComment(db, person("ann"), { videoId: v.id, body: "Bedtime is our best time." }, T0);
      const r1 = await postComment(db, person("ben"), { videoId: v.id, body: "Same here! <b>Every</b> night.", parentId: root.id }, hours(1));
      const r2 = await postComment(db, person("cal"), { videoId: v.id, body: "Us too.", parentId: r1.id }, hours(2));
      const own = await postComment(db, person("ann"), { videoId: v.id, body: "Thanks both.", parentId: root.id }, hours(3));

      const opts = (h: number) => ({ appUrl: APP, now: hours(h) });
      expect(await notifyReply(db, mailer, r1.id, opts(1))).toEqual({ sent: true });
      expect(await notifyReply(db, mailer, r2.id, opts(2))).toEqual({ sent: false, reason: "recently_notified" });
      expect(await notifyReply(db, mailer, own.id, opts(3))).toEqual({ sent: false, reason: "own_thread" });
      expect(await notifyReply(db, mailer, root.id, opts(3))).toEqual({ sent: false, reason: "not_a_reply" });
      // A later window gets a new email.
      expect(await notifyReply(db, mailer, r2.id, opts(7))).toEqual({ sent: true });

      const [first] = mailer.sent;
      expect(first).toMatchObject({ to: "ann@test.dev", subject: 'Ben S. replied to your comment on "Bedtime"' });
      expect(first!.html).toContain("Same here! &lt;b&gt;Every&lt;/b&gt; night.");
      expect(first!.text).toContain(`${APP}/community/${v.id}?utm_source=email&utm_medium=email&utm_campaign=comment-reply#comments`);
      expect(first!.headers!["List-Unsubscribe"]).toContain("c=replies");
    });

    it("links lesson conversations to the lesson, and respects opt-outs and moderation", async () => {
      const { c, v, l } = await course("Present Fathers", days(-60));
      await membership("ann", days(-5), days(300));
      await membership("ben", days(-5), days(300));
      const root = await postComment(db, person("ann"), { videoId: v.id, body: "Great lesson." }, T0);
      const reply = await postComment(db, person("ben"), { videoId: v.id, body: "Agreed.", parentId: root.id }, hours(1));

      await updatePreferences(db, "ann", { replies: false });
      expect(await notifyReply(db, mailer, reply.id, { appUrl: APP, now: hours(1) })).toEqual({ sent: false, reason: "opted_out" });
      await updatePreferences(db, "ann", { replies: true });
      await moderateComment(db, reply.id, "hide", "author");
      expect(await notifyReply(db, mailer, reply.id, { appUrl: APP, now: hours(1) })).toEqual({ sent: false, reason: "not_visible" });
      await moderateComment(db, reply.id, "restore", "author");
      expect(await notifyReply(db, mailer, reply.id, { appUrl: APP, now: hours(1) })).toEqual({ sent: true });
      expect(mailer.sent[0]!.text).toContain(`${APP}/academy/${c.slug}/${l.id}?`);
    });

    it("records a failed send so the window can't be retried into a duplicate", async () => {
      const v = await video();
      const root = await postComment(db, person("ann"), { videoId: v.id, body: "Hello there." }, T0);
      const reply = await postComment(db, person("ben"), { videoId: v.id, body: "Hi!", parentId: root.id }, hours(1));
      mailer.failures = 1;
      await expect(notifyReply(db, mailer, reply.id, { appUrl: APP, now: hours(1) })).rejects.toThrow("Resend is down");
      const [send] = await db.select().from(schema.emailSends);
      expect(send).toMatchObject({ status: "failed", category: "replies", userId: "ann" });
    });
  });

  it("stores preferences only when changed", async () => {
    await account("sam", "Sam", days(-1));
    expect(await getPreferences(db, "sam")).toEqual({ learning: true, announcements: true, replies: true });
    expect(await db.$count(schema.emailPreferences)).toBe(0);
    expect(await unsubscribe(db, "sam", "announcements")).toEqual({ learning: true, announcements: false, replies: true });
    expect(await unsubscribe(db, "sam", "all")).toEqual({ learning: false, announcements: false, replies: false });
    expect(await updatePreferences(db, "sam", { replies: true })).toEqual({ learning: false, announcements: false, replies: true });
  });
});
