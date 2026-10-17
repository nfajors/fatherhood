/**
 * Creator Studio against a real Postgres: uploads and resubmission, the
 * dashboard and earnings, and Fellow applications. Runs only when
 * TEST_DATABASE_URL points at a disposable database (tables are truncated).
 */
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import type { EmailMessage, Mailer } from "@/lib/email";
import { applyReview } from "@/lib/moderation/service";
import { settlePeriod } from "@/lib/revenue/settlement";
import { monthPeriod } from "@/lib/revenue/pool";
import { applyToBeFellow, ApplicationError, decideApplication, grantFellow, latestApplication, pendingApplications, revokeFellow } from "./applications";
import { dailyViews, earningsEstimate, earningsHistory, studioSummary, studioVideo, studioVideos } from "./dashboard";
import { beginUpload, createDraft, deleteVideo, markUploaded, resubmit, StudioError, updateDetails, type UploadStarter } from "./videos";

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-17T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 3_600_000);

class RecordingMailer implements Mailer {
  sent: EmailMessage[] = [];
  async send(message: EmailMessage) {
    this.sent.push(message);
  }
}

class FakeStream implements UploadStarter {
  calls: Parameters<UploadStarter["createTusUpload"]>[0][] = [];
  async createTusUpload(options: Parameters<UploadStarter["createTusUpload"]>[0]) {
    this.calls.push(options);
    return { uploadURL: `https://upload.test/tus/${this.calls.length}`, uid: `uid${this.calls.length}` };
  }
}

describe.skipIf(!url)("creator studio (Postgres)", () => {
  let client: postgres.Sql;
  let db: Database;
  let stream: FakeStream;
  let mailer: RecordingMailer;
  const fellow = { id: "fellow", role: "creator" as const };

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
      sql`truncate creator_applications, creator_payouts, pool_calculations, revenue_ledger, watch_sessions, video_reviews, videos, "user" cascade`,
    );
    await db.insert(schema.user).values([
      { id: "fellow", name: "James", email: "james@test.dev", role: "creator" },
      { id: "other", name: "Marcus", email: "marcus@test.dev", role: "creator" },
      { id: "admin", name: "Ada Admin", email: "admin@test.dev", role: "admin" },
      { id: "dad", name: "Sam", email: "sam@test.dev" },
    ]);
    stream = new FakeStream();
    mailer = new RecordingMailer();
  });

  const row = async (id: string) => (await db.query.videos.findFirst({ where: eq(schema.videos.id, id) }))!;
  const reviews = async (id: string) =>
    db.select().from(schema.videoReviews).where(eq(schema.videoReviews.videoId, id)).orderBy(schema.videoReviews.createdAt);

  async function published(creatorId: string, title: string, publishedAt = daysAgo(5)) {
    const [video] = await db
      .insert(schema.videos)
      .values({ type: "community", status: "approved", creatorId, title, cloudflareUid: `pub-${title}`, durationSeconds: 300, requireSignedUrls: false, publishedAt })
      .returning();
    return video!;
  }

  async function views(videoId: string, count: number, seconds = 45, startedAt = daysAgo(1)) {
    await db.insert(schema.watchSessions).values(Array.from({ length: count }, () => ({ videoId, secondsWatched: seconds, startedAt })));
    await db.update(schema.videos).set({ viewCount: sql`${schema.videos.viewCount} + ${seconds >= 30 ? count : 0}` }).where(eq(schema.videos.id, videoId));
  }

  describe("uploads", () => {
    it("lets Fellows upload Community videos and only admins upload lessons", async () => {
      const draft = await createDraft(db, fellow, { type: "community", title: "  Bedtime over video call ", tags: ["nights"] });
      expect(draft).toMatchObject({ status: "uploading", title: "Bedtime over video call", requireSignedUrls: false, cloudflareUid: null });
      await expect(createDraft(db, fellow, { type: "professional", title: "Lesson" })).rejects.toMatchObject({ reason: "forbidden" });
      await expect(createDraft(db, { id: "dad", role: "user" }, { type: "community", title: "Story" })).rejects.toMatchObject({ reason: "forbidden" });
      expect(await createDraft(db, { id: "admin", role: "admin" }, { type: "professional", title: "Lesson" })).toMatchObject({ requireSignedUrls: true });
    });

    it("starts a capped, watermarked upload and refuses oversized files and other people's videos", async () => {
      const draft = await createDraft(db, fellow, { type: "community", title: "Story" });
      const started = await beginUpload(db, stream, { creatorId: "fellow", videoId: draft.id, uploadLength: 50_000_000, watermarkUid: "wm" }, NOW);
      expect(started).toEqual({ uploadURL: "https://upload.test/tus/1", replacedUid: null });
      expect(stream.calls[0]).toMatchObject({ maxDurationSeconds: 480, requireSignedURLs: false, watermarkUid: "wm", creatorId: "fellow", name: "Story" });
      expect(await row(draft.id)).toMatchObject({ status: "uploading", cloudflareUid: "uid1", watermarkApplied: true });

      // Retrying a stalled upload replaces the first attempt without a history entry.
      expect((await beginUpload(db, stream, { creatorId: "fellow", videoId: draft.id, uploadLength: 1 }, NOW)).replacedUid).toBe("uid1");
      expect(await reviews(draft.id)).toEqual([]);

      await expect(beginUpload(db, stream, { creatorId: "fellow", videoId: draft.id, uploadLength: 6 * 1024 ** 3 })).rejects.toMatchObject({ reason: "too_large" });
      await expect(beginUpload(db, stream, { creatorId: "other", videoId: draft.id, uploadLength: 1 })).rejects.toMatchObject({ reason: "not_found" });
    });

    it("replaces the file after a change request, resetting the screen and logging it", async () => {
      const draft = await createDraft(db, fellow, { type: "community", title: "Story" });
      await beginUpload(db, stream, { creatorId: "fellow", videoId: draft.id, uploadLength: 1 }, NOW);
      await db
        .update(schema.videos)
        .set({ status: "pending_review", durationSeconds: 300, transcript: "old words", screenedAt: NOW, aiRisk: "medium", aiRecommendation: "review" })
        .where(eq(schema.videos.id, draft.id));
      await applyReview(db, { videoId: draft.id, action: "request_changes", reviewerId: "admin", notes: "The audio drops out at 2:10." }, null, NOW);

      const replaced = await beginUpload(db, stream, { creatorId: "fellow", videoId: draft.id, uploadLength: 1 }, NOW);
      expect(replaced.replacedUid).toBe("uid1");
      expect(await row(draft.id)).toMatchObject({
        status: "uploading",
        cloudflareUid: "uid2",
        durationSeconds: null,
        transcript: null,
        screenedAt: null,
        aiRisk: null,
      });
      expect((await reviews(draft.id)).map((r) => [r.action, r.toStatus])).toEqual([
        ["request_changes", "changes_requested"],
        ["resubmit", "uploading"],
      ]);
    });

    it("shows a finished upload as processing once Stream has the file, without overtaking the webhook", async () => {
      const draft = await createDraft(db, fellow, { type: "community", title: "Story" });
      await beginUpload(db, stream, { creatorId: "fellow", videoId: draft.id, uploadLength: 1 }, NOW);
      const state = { value: "pendingupload" as string };
      const checker = { getVideo: async () => ({ status: { state: state.value } }) as never };
      expect((await markUploaded(db, checker, "fellow", draft.id)).status).toBe("uploading");
      state.value = "inprogress";
      expect((await markUploaded(db, checker, "fellow", draft.id)).status).toBe("processing");
      await db.update(schema.videos).set({ status: "pending_review" }).where(eq(schema.videos.id, draft.id));
      expect((await markUploaded(db, checker, "fellow", draft.id)).status).toBe("pending_review");
      await expect(markUploaded(db, checker, "other", draft.id)).rejects.toMatchObject({ reason: "not_found" });
    });

    it("edits details until publication, then locks them", async () => {
      const draft = await createDraft(db, fellow, { type: "community", title: "Story" });
      expect(await updateDetails(db, "fellow", draft.id, { title: " Better title ", tags: ["a"] })).toMatchObject({ title: "Better title", tags: ["a"] });
      const live = await published("fellow", "Live");
      await expect(updateDetails(db, "fellow", live.id, { title: "Sneaky" })).rejects.toMatchObject({ reason: "not_allowed_now" });
      await expect(beginUpload(db, stream, { creatorId: "fellow", videoId: live.id, uploadLength: 1 })).rejects.toBeInstanceOf(StudioError);
    });

    it("resubmits after a change request with a new deadline and a fresh screen", async () => {
      const [video] = await db
        .insert(schema.videos)
        .values({ type: "community", status: "pending_review", creatorId: "fellow", title: "Story", cloudflareUid: "x", requireSignedUrls: false, transcript: "words", screenedAt: NOW, aiRisk: "medium" })
        .returning();
      await expect(resubmit(db, "fellow", video!.id, null)).rejects.toMatchObject({ reason: "not_allowed_now" });
      await applyReview(db, { videoId: video!.id, action: "request_changes", reviewerId: "admin", notes: "Retitle it." }, null, NOW);
      await updateDetails(db, "fellow", video!.id, { title: "Working nights, still at bedtime" });

      const after = await resubmit(db, "fellow", video!.id, " Retitled as asked. ", NOW);
      expect(after).toMatchObject({ status: "pending_review", reviewDueAt: new Date(NOW.getTime() + 48 * 3_600_000), screenedAt: null, aiRisk: null, transcript: "words" });
      expect((await reviews(video!.id)).at(-1)).toMatchObject({ action: "resubmit", notes: "Retitled as asked.", reviewerId: null });
    });

    it("deletes unpublished videos only", async () => {
      const draft = await createDraft(db, fellow, { type: "community", title: "Story" });
      await beginUpload(db, stream, { creatorId: "fellow", videoId: draft.id, uploadLength: 1 }, NOW);
      expect(await deleteVideo(db, "fellow", draft.id)).toEqual({ cloudflareUid: "uid1" });
      expect(await db.$count(schema.videos)).toBe(0);
      const live = await published("fellow", "Live");
      await expect(deleteVideo(db, "fellow", live.id)).rejects.toMatchObject({ reason: "not_allowed_now" });
    });
  });

  describe("dashboard", () => {
    it("lists the creator's videos with numbers and the latest reviewer decision, never the AI screen", async () => {
      const live = await published("fellow", "Live");
      await views(live.id, 3, 60);
      await views(live.id, 2, 10); // too short to count as views
      const [changes] = await db
        .insert(schema.videos)
        .values({ type: "community", status: "pending_review", creatorId: "fellow", title: "Needs work", cloudflareUid: "nw", requireSignedUrls: false })
        .returning();
      await db.insert(schema.videoReviews).values({ videoId: changes!.id, action: "ai_screen", toStatus: "pending_review", notes: "AI recommends reject" });
      await applyReview(db, { videoId: changes!.id, action: "request_changes", reviewerId: "admin", notes: "Shorten the intro." }, null, NOW);
      await published("other", "Not mine");

      const list = await studioVideos(db, "fellow");
      expect(list.map((v) => [v.title, v.status, v.views, v.watchSeconds, v.lastDecision?.notes ?? null])).toEqual([
        ["Needs work", "changes_requested", 0, 0, "Shorten the intro."],
        ["Live", "approved", 3, 200, null],
      ]);

      const detail = (await studioVideo(db, "fellow", changes!.id))!;
      expect(detail.history.map((h) => h.action)).toEqual(["request_changes"]);
      expect(await studioVideo(db, "other", changes!.id)).toBeNull();

      expect(await studioSummary(db, "fellow", NOW)).toMatchObject({
        published: 1,
        inReview: 0,
        needsAttention: 1,
        views: 3,
        recentViews: 3,
        watchSeconds: 200,
      });
    });

    it("counts daily views for the last 30 days, filling empty days", async () => {
      const live = await published("fellow", "Live");
      await views(live.id, 2, 45, daysAgo(1));
      await views(live.id, 1, 45, daysAgo(40));
      const days = await dailyViews(db, "fellow", 30, NOW);
      expect(days).toHaveLength(30);
      expect(days.at(-1)!.day).toBe("2026-10-17");
      expect(days.find((d) => d.day === "2026-10-16")!.views).toBe(2);
      expect(days.reduce((sum, d) => sum + d.views, 0)).toBe(2);
    });
  });

  describe("earnings", () => {
    it("estimates this month exactly as settlement will, showing only the creator's own figures", async () => {
      const mine = await published("fellow", "Mine", daysAgo(3));
      const theirs = await published("other", "Theirs", daysAgo(3));
      await views(mine.id, 30);
      await views(theirs.id, 10);
      const quiet = await published("fellow", "Quiet", daysAgo(3));
      await views(quiet.id, 4);
      await db.insert(schema.revenueLedger).values({ kind: "subscription_invoice", stripeObjectId: "in_1", amountCents: 100_000, occurredAt: daysAgo(2) });

      const estimate = await earningsEstimate(db, "fellow", NOW);
      expect(estimate).toMatchObject({
        eligible: true,
        checks: { postedThisQuarter: true, videoReachedViewThreshold: true },
        videosPostedInQuarter: 2,
        qualifyingViews: 30,
      });
      expect(estimate.videos.map((v) => [v.title, v.qualifyingViews, v.counts])).toEqual([
        ["Mine", 30, true],
        ["Quiet", 4, false],
      ]);
      expect(estimate).not.toHaveProperty("poolCents");

      // Settle the month to date: the estimate matches the recorded share.
      const settled = await settlePeriod(db, { start: monthPeriod(2026, 10).start, end: NOW });
      expect(estimate.estimatedCents).toBe(settled.shares.find((s) => s.creatorId === "fellow")!.amountCents);
      expect(estimate.estimatedCents).toBeGreaterThan(0);
    });

    it("explains ineligibility instead of estimating", async () => {
      const old = await published("fellow", "Old", new Date("2026-06-01T00:00:00Z"));
      await views(old.id, 50);
      const estimate = await earningsEstimate(db, "fellow", NOW);
      expect(estimate).toMatchObject({ eligible: false, checks: { postedThisQuarter: false, videoReachedViewThreshold: true }, estimatedCents: 0 });
    });

    it("shows settled shares with titles, payouts and balances", async () => {
      const mine = await published("fellow", "Mine", new Date("2026-09-02T00:00:00Z"));
      await views(mine.id, 12, 45, new Date("2026-09-10T00:00:00Z"));
      await db.insert(schema.revenueLedger).values({ kind: "subscription_invoice", stripeObjectId: "in_9", amountCents: 50_000, occurredAt: new Date("2026-09-05T00:00:00Z") });
      await settlePeriod(db, monthPeriod(2026, 9));

      const history = await earningsHistory(db, "fellow");
      expect(history.shares).toHaveLength(1);
      expect(history.shares[0]!.breakdown).toEqual([{ videoId: mine.id, qualifyingViews: 12, title: "Mine" }]);
      const total = history.shares[0]!.amountCents;
      expect(history.balances).toMatchObject({ minPayoutCents: 2000 });
      expect(history.balances.unpaidCents + history.balances.inPayoutCents).toBe(total);
      expect((await earningsHistory(db, "other")).shares).toEqual([]);
    });
  });

  describe("Fellow applications", () => {
    const notifyWith = () => ({ mailer, studioUrl: "https://fatherhood.school/studio" });

    it("takes one open application, and an approval makes the applicant a Fellow", async () => {
      const application = await applyToBeFellow(db, "dad", { statement: "I've raised three kids on night shifts.", sampleUrl: " https://example.com/me " });
      expect(application).toMatchObject({ status: "pending", sampleUrl: "https://example.com/me" });
      await expect(applyToBeFellow(db, "dad", { statement: "Again" })).rejects.toMatchObject({ reason: "already_pending" });
      await expect(applyToBeFellow(db, "fellow", { statement: "x" })).rejects.toMatchObject({ reason: "already_fellow" });
      expect((await pendingApplications(db)).map((a) => a.email)).toEqual(["sam@test.dev"]);

      await decideApplication(db, { applicationId: application.id, adminId: "admin", decision: "approved", notes: "Welcome aboard." }, notifyWith(), NOW);
      expect((await db.query.user.findFirst({ where: eq(schema.user.id, "dad") }))!.role).toBe("creator");
      expect(await latestApplication(db, "dad")).toMatchObject({ status: "approved", reviewedById: "admin", decisionNotes: "Welcome aboard." });
      expect(mailer.sent[0]).toMatchObject({ to: "sam@test.dev", subject: "Welcome to the Fatherhood.School Fellows" });
      expect(mailer.sent[0]!.text).toContain("https://fatherhood.school/studio");

      await expect(
        decideApplication(db, { applicationId: application.id, adminId: "admin", decision: "rejected" }, notifyWith()),
      ).rejects.toMatchObject({ reason: "already_decided" });
    });

    it("declines with a reason and lets the person apply again later", async () => {
      const first = await applyToBeFellow(db, "dad", { statement: "First try" });
      await decideApplication(db, { applicationId: first.id, adminId: "admin", decision: "rejected", notes: "Please share a sample." }, notifyWith());
      expect((await db.query.user.findFirst({ where: eq(schema.user.id, "dad") }))!.role).toBe("user");
      expect(mailer.sent[0]!.text).toContain("Please share a sample.");
      expect(await applyToBeFellow(db, "dad", { statement: "Second try", sampleUrl: "https://example.com" })).toMatchObject({ status: "pending" });
    });

    it("grants access by email, approving any open application, and revokes it", async () => {
      await applyToBeFellow(db, "dad", { statement: "Hi" });
      expect(await grantFellow(db, { email: " SAM@test.dev ", adminId: "admin" }, notifyWith(), NOW)).toEqual({ name: "Sam", alreadyFellow: false, emailed: true });
      expect(await latestApplication(db, "dad")).toMatchObject({ status: "approved" });
      expect(await grantFellow(db, { email: "admin@test.dev", adminId: "admin" }, notifyWith())).toMatchObject({ alreadyFellow: true, emailed: false });
      await expect(grantFellow(db, { email: "nobody@test.dev", adminId: "admin" }, notifyWith())).rejects.toBeInstanceOf(ApplicationError);

      await revokeFellow(db, "dad");
      expect((await db.query.user.findFirst({ where: eq(schema.user.id, "dad") }))!.role).toBe("user");
      await expect(revokeFellow(db, "admin")).rejects.toMatchObject({ reason: "not_found" });
    });
  });
});
