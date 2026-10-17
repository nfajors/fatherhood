/**
 * Moderation pipeline against a real Postgres, with fake Stream media, a
 * scripted screener and a recording mailer. Runs only when TEST_DATABASE_URL
 * points at a disposable database (tables are truncated).
 */
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import type { EmailMessage, Mailer } from "@/lib/email";
import { RISK_CATEGORIES } from "./policy";
import type { ScreenInput, ScreenResult, VideoScreener } from "./screen";
import {
  applyReview,
  bulkApprove,
  moderationSummary,
  ModerationError,
  reportQueue,
  reportVideo,
  resolveReports,
  reviewDetail,
  reviewQueue,
  screenPendingVideos,
  screenVideo,
  type MediaSource,
} from "./service";

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-17T12:00:00Z");
const minutesLater = (m: number) => new Date(NOW.getTime() + m * 60_000);

class RecordingMailer implements Mailer {
  sent: EmailMessage[] = [];
  async send(message: EmailMessage) {
    this.sent.push(message);
  }
}

class FakeMedia implements MediaSource {
  requested: string[] = [];
  status: "none" | "inprogress" | "ready" | "error" = "inprogress";
  vtt = "WEBVTT\n\n00:00.000 --> 00:03.000\nI work nights, so bedtime is a video call.\n";
  async requestCaptions(video: { id: string }) {
    this.requested.push(video.id);
  }
  async captionStatus() {
    return this.status;
  }
  async captionVtt() {
    return this.vtt;
  }
  async frameUrls() {
    return ["https://frames/1.jpg", "https://frames/2.jpg"];
  }
}

const noRisk = () => Object.fromEntries(Object.keys(RISK_CATEGORIES).map((k) => [k, "none"]));

const cleanScreen = (overrides: Record<string, unknown> = {}): ScreenResult =>
  ({
    kind: "screened",
    model: "test",
    hadTranscript: true,
    frameCount: 2,
    summary: "A father on staying close while working nights.",
    categories: noRisk(),
    concerns: [],
    relevance: 92,
    quality_notes: [],
    recommendation: "approve",
    recommendation_reason: "Clean and on topic.",
    ...overrides,
  }) as unknown as ScreenResult;

class ScriptedScreener implements VideoScreener {
  readonly model = "test";
  inputs: ScreenInput[] = [];
  constructor(private result: (input: ScreenInput) => ScreenResult = (i) => cleanScreen({ hadTranscript: Boolean(i.transcript) })) {}
  async screen(input: ScreenInput) {
    this.inputs.push(input);
    return this.result(input);
  }
}

describe.skipIf(!url)("moderation (Postgres)", () => {
  let client: postgres.Sql;
  let db: Database;
  let mailer: RecordingMailer;
  let media: FakeMedia;
  let screener: ScriptedScreener;

  beforeAll(async () => {
    client = postgres(url!, { max: 4, onnotice: () => {} });
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: "drizzle" });
  });

  afterAll(async () => {
    await client?.end();
  });

  beforeEach(async () => {
    await db.execute(sql`truncate content_reports, video_reviews, theme_assignments, videos, "user" cascade`);
    await db.insert(schema.user).values([
      { id: "fellow", name: "James", email: "james@test.dev", role: "creator" },
      { id: "admin", name: "Ada Admin", email: "admin@test.dev", role: "admin" },
      ...["r1", "r2", "r3", "r4"].map((id) => ({ id, name: id, email: `${id}@test.dev` })),
    ]);
    mailer = new RecordingMailer();
    media = new FakeMedia();
    screener = new ScriptedScreener();
    n = 0;
  });

  let n = 0;
  async function queued(overrides: Partial<typeof schema.videos.$inferInsert> = {}) {
    n++;
    const [video] = await db
      .insert(schema.videos)
      .values({
        type: "community",
        status: "pending_review",
        creatorId: "fellow",
        title: `Video ${n}`,
        cloudflareUid: `cf${n}`,
        durationSeconds: 300,
        requireSignedUrls: false,
        reviewDueAt: new Date(NOW.getTime() + 48 * 3_600_000),
        ...overrides,
      })
      .returning();
    return video!;
  }
  const row = async (id: string) => (await db.query.videos.findFirst({ where: eq(schema.videos.id, id) }))!;
  const deps = () => ({ media, screener, mailer });

  describe("review decisions", () => {
    it("approves, publishes, records the reviewer and emails the creator", async () => {
      const video = await queued();
      const { emailed } = await applyReview(db, { videoId: video.id, action: "approve", reviewerId: "admin", notes: "Lovely." }, mailer, NOW);

      expect(emailed).toBe(true);
      expect(await row(video.id)).toMatchObject({ status: "approved", publishedAt: NOW, reviewDueAt: null });
      expect(mailer.sent[0]).toMatchObject({ to: "james@test.dev", subject: 'Your video "Video 1" is live' });
      expect(mailer.sent[0]!.idempotencyKey).toMatch(/^video-review-/);
      const [review] = await db.select().from(schema.videoReviews).where(eq(schema.videoReviews.videoId, video.id));
      expect(review).toMatchObject({ action: "approve", reviewerId: "admin", fromStatus: "pending_review", toStatus: "approved", notes: "Lovely." });
    });

    it("requires notes for negative decisions", async () => {
      const video = await queued();
      for (const action of ["reject", "request_changes"] as const) {
        await expect(applyReview(db, { videoId: video.id, action, reviewerId: "admin", notes: "  " }, mailer, NOW)).rejects.toMatchObject({
          reason: "notes_required",
        });
      }
      expect((await row(video.id)).status).toBe("pending_review");
    });

    it("walks the full lifecycle and refuses transitions that don't apply", async () => {
      const video = await queued();
      await applyReview(db, { videoId: video.id, action: "request_changes", reviewerId: "admin", notes: "Trim the intro." }, mailer, NOW);
      await expect(applyReview(db, { videoId: video.id, action: "request_changes", reviewerId: "admin", notes: "x" }, mailer, NOW)).rejects.toMatchObject({
        reason: "invalid_transition",
      });
      await applyReview(db, { videoId: video.id, action: "approve", reviewerId: "admin" }, mailer, NOW);
      await applyReview(db, { videoId: video.id, action: "unpublish", reviewerId: "admin", notes: "Reported for privacy." }, mailer, NOW);
      await applyReview(db, { videoId: video.id, action: "restore", reviewerId: "admin" }, mailer, NOW);
      expect((await row(video.id)).status).toBe("approved");
      // Restoring doesn't email; the other three decisions did.
      expect(mailer.sent.map((m) => m.subject)).toEqual([
        'Changes requested for "Video 1"',
        'Your video "Video 1" is live',
        'Your video "Video 1" has been taken down',
      ]);
      await expect(applyReview(db, { videoId: "00000000-0000-4000-8000-000000000000", action: "approve", reviewerId: "admin" }, mailer)).rejects.toMatchObject({
        reason: "not_found",
      });
    });

    it("lets only one of two simultaneous decisions win", async () => {
      const video = await queued();
      const results = await Promise.allSettled([
        applyReview(db, { videoId: video.id, action: "approve", reviewerId: "admin" }, mailer, NOW),
        applyReview(db, { videoId: video.id, action: "reject", reviewerId: "admin", notes: "No." }, mailer, NOW),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await db.$count(schema.videoReviews, eq(schema.videoReviews.videoId, video.id))).toBe(1);
    });

    it("bulk-approves what it can and reports the rest", async () => {
      const a = await queued();
      const b = await queued({ status: "approved" });
      const result = await bulkApprove(db, [a.id, b.id], "admin", mailer, NOW);
      expect(result.approved).toEqual([a.id]);
      expect(result.failed).toEqual([expect.objectContaining({ id: b.id, message: expect.stringContaining("approved") })]);
    });
  });

  describe("AI pre-screen", () => {
    it("requests captions first, waits for them, then screens with the transcript", async () => {
      const video = await queued();
      expect(await screenVideo(db, video.id, deps(), { now: NOW })).toEqual({ state: "waiting_for_captions" });
      expect(media.requested).toEqual([video.id]);
      expect(await screenVideo(db, video.id, deps(), { now: minutesLater(5) })).toEqual({ state: "waiting_for_captions" });

      media.status = "ready";
      const outcome = await screenVideo(db, video.id, deps(), { now: minutesLater(10) });
      expect(outcome).toMatchObject({ state: "screened", decision: { autoApprove: false, risk: "low" } });
      expect(screener.inputs[0]).toMatchObject({ transcript: "I work nights, so bedtime is a video call.", frameUrls: ["https://frames/1.jpg", "https://frames/2.jpg"] });
      expect(await row(video.id)).toMatchObject({
        status: "pending_review",
        transcript: "I work nights, so bedtime is a video call.",
        aiRisk: "low",
        aiRecommendation: "approve",
        screenedAt: minutesLater(10),
      });
      expect((await row(video.id)).moderation).toMatchObject({ autoApprovalBlockers: ["This creator's first video needs a human review."] });
    });

    it("screens without a transcript once the wait runs out", async () => {
      const video = await queued();
      await screenVideo(db, video.id, deps(), { now: NOW });
      const outcome = await screenVideo(db, video.id, deps(), { now: minutesLater(31) });
      expect(outcome.state).toBe("screened");
      expect(screener.inputs[0]!.transcript).toBeNull();
    });

    it("auto-approves a clean video from a creator with an earlier human approval", async () => {
      const earlier = await queued();
      await applyReview(db, { videoId: earlier.id, action: "approve", reviewerId: "admin" }, null, NOW);
      media.status = "ready";
      const video = await queued();
      await screenVideo(db, video.id, deps(), { now: NOW });
      const outcome = await screenVideo(db, video.id, deps(), { now: minutesLater(1) });

      expect(outcome.state).toBe("auto_approved");
      expect(await row(video.id)).toMatchObject({ status: "approved", publishedAt: minutesLater(1) });
      const actions = (await db.select().from(schema.videoReviews).where(eq(schema.videoReviews.videoId, video.id))).map((r) => r.action);
      expect(actions.sort()).toEqual(["ai_screen", "auto_approve"]);
      expect(mailer.sent.at(-1)!.subject).toBe('Your video "Video 2" is live');
    });

    it("never auto-approves on a system approval alone, or a risky screen", async () => {
      const earlier = await queued();
      await applyReview(db, { videoId: earlier.id, action: "auto_approve", reviewerId: null }, null, NOW);
      media.status = "ready";
      const video = await queued();
      await screenVideo(db, video.id, deps(), { now: NOW, force: true });
      expect((await row(video.id)).status).toBe("pending_review");

      await applyReview(db, { videoId: earlier.id, action: "unpublish", reviewerId: "admin", notes: "x" }, null, NOW);
      await applyReview(db, { videoId: earlier.id, action: "restore", reviewerId: "admin" }, null, NOW);
      const risky = new ScriptedScreener(() => cleanScreen({ categories: { ...noRisk(), hate_or_harassment: "high" } }));
      const third = await queued();
      const outcome = await screenVideo(db, third.id, { media, screener: risky, mailer }, { now: NOW, force: true });
      expect(outcome).toMatchObject({ state: "screened", decision: { priority: "urgent", risk: "high" } });
    });

    it("keeps a declined screen in the queue as high risk", async () => {
      media.status = "ready";
      const declining = new ScriptedScreener(() => ({ kind: "declined", model: "test", category: "general_harms", hadTranscript: true, frameCount: 2 }));
      const video = await queued();
      await screenVideo(db, video.id, { media, screener: declining, mailer }, { now: NOW, force: true });
      expect(await row(video.id)).toMatchObject({ status: "pending_review", aiRisk: "high", aiRecommendation: "review" });
    });

    it("screens the whole queue, isolating failures", async () => {
      media.status = "ready";
      const ok = await queued();
      const broken = await queued();
      await queued({ status: "approved" }); // not in the queue
      const flaky = new ScriptedScreener((i) => {
        if (i.title === broken.title) throw new Error("model overloaded");
        return cleanScreen();
      });
      await db.update(schema.videos).set({ captionsRequestedAt: NOW });
      const summary = await screenPendingVideos(db, { media, screener: flaky, mailer }, minutesLater(1));
      expect(summary).toMatchObject({ screened: 1, autoApproved: 0, waiting: 0, failed: [{ id: broken.id, message: "model overloaded" }] });
      expect((await row(ok.id)).screenedAt).not.toBeNull();
      expect((await row(broken.id)).screenedAt).toBeNull();
    });
  });

  describe("reports", () => {
    it("takes one open report per person and hides the video at three, without emailing", async () => {
      const video = await queued({ status: "approved" });
      expect(await reportVideo(db, { videoId: video.id, reporterId: "r1", reason: "spam" }, NOW)).toEqual({ alreadyReported: false, hidden: false });
      expect(await reportVideo(db, { videoId: video.id, reporterId: "r1", reason: "other" }, NOW)).toEqual({ alreadyReported: true, hidden: false });
      await reportVideo(db, { videoId: video.id, reporterId: "r2", reason: "inappropriate", details: "Language" }, NOW);
      expect(await reportVideo(db, { videoId: video.id, reporterId: "r3", reason: "spam" }, NOW)).toEqual({ alreadyReported: false, hidden: true });

      expect((await row(video.id)).status).toBe("unpublished");
      expect(mailer.sent).toEqual([]);
      const [queueItem] = await reportQueue(db);
      expect(queueItem).toMatchObject({ id: video.id, reporters: 3, status: "unpublished", details: ["Language"] });
      expect(queueItem!.reasons.sort()).toEqual(["inappropriate", "spam"]);
    });

    it("only accepts reports on published videos", async () => {
      const video = await queued();
      await expect(reportVideo(db, { videoId: video.id, reporterId: "r1", reason: "spam" })).rejects.toThrowError(ModerationError);
    });

    it("resolves reports and lets the same person report again later", async () => {
      const video = await queued({ status: "approved" });
      await reportVideo(db, { videoId: video.id, reporterId: "r1", reason: "spam" }, NOW);
      expect(await resolveReports(db, { videoId: video.id, reviewerId: "admin", outcome: "dismissed" }, NOW)).toBe(1);
      expect(await reportQueue(db)).toEqual([]);
      expect((await reportVideo(db, { videoId: video.id, reporterId: "r1", reason: "spam" }, NOW)).alreadyReported).toBe(false);
    });
  });

  describe("queues", () => {
    it("orders by risk, then deadline, and summarizes the workload", async () => {
      const soon = await queued({ reviewDueAt: minutesLater(60), aiRisk: "low", screenedAt: NOW });
      const late = await queued({ reviewDueAt: minutesLater(-60), aiRisk: "low", screenedAt: NOW });
      const risky = await queued({ reviewDueAt: minutesLater(3000), aiRisk: "high", screenedAt: NOW });
      const medium = await queued({ reviewDueAt: minutesLater(2000), aiRisk: "medium", screenedAt: NOW });
      const unscreened = await queued({ reviewDueAt: minutesLater(30) });
      await queued({ status: "changes_requested" });

      const queue = await reviewQueue(db, NOW);
      expect(queue.map((q) => q.id)).toEqual([risky.id, medium.id, late.id, unscreened.id, soon.id]);
      expect(queue.find((q) => q.id === late.id)!.sla).toBe("overdue");
      expect(queue.find((q) => q.id === soon.id)!.sla).toBe("due_soon");
      expect(await moderationSummary(db, NOW)).toEqual({ pending: 5, overdue: 1, dueSoon: 2, awaitingScreen: 1, changesRequested: 1, openReports: 0 });
    });

    it("assembles the review page", async () => {
      const video = await queued();
      await applyReview(db, { videoId: video.id, action: "request_changes", reviewerId: "admin", notes: "Trim it." }, null, NOW);
      const detail = await reviewDetail(db, video.id);
      expect(detail).toMatchObject({ creator: { name: "James", email: "james@test.dev" }, screen: null, reports: [], themes: [] });
      expect(detail!.history).toEqual([expect.objectContaining({ action: "request_changes", reviewer: "Ada Admin", notes: "Trim it." })]);
      expect(await reviewDetail(db, "00000000-0000-4000-8000-000000000000")).toBeNull();
    });
  });
});
