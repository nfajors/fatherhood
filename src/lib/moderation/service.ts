/**
 * The moderation pipeline (docs/development-plan.md 3.4):
 *
 *   ready -> pending_review -> [captions] -> AI screen -> auto-approve (narrow) or human queue
 *   human review: approve / request changes / reject; later unpublish / restore
 *   reports on published videos: enough distinct reporters hide the video until reviewed
 *
 * Every status change goes through applyReview, which enforces the allowed
 * transitions, records the audit trail in video_reviews and emails the creator.
 */
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import {
  contentReports,
  themeAssignments,
  themes,
  user,
  videoReviews,
  videos,
  type VideoReviewAction,
  type VideoStatus,
} from "@/lib/db/schema";
import type { Mailer } from "@/lib/email";
import { decide, slaState, type SlaState } from "./decide";
import { decisionEmail, type DecisionEmailInput } from "./emails";
import { MODERATION_POLICY as P, REPORT_REASONS, type ReportReason } from "./policy";
import type { ScreenResult, VideoScreener } from "./screen";
import { vttToText } from "./vtt";

export type Video = typeof videos.$inferSelect;

export class ModerationError extends Error {
  constructor(
    readonly reason: "not_found" | "invalid_transition" | "notes_required" | "not_reportable",
    message: string,
  ) {
    super(message);
    this.name = "ModerationError";
  }
}

// ---------------------------------------------------------------------------
// Review decisions
// ---------------------------------------------------------------------------

type Transition = {
  from: VideoStatus[];
  to: VideoStatus;
  notesRequired: boolean;
  email: DecisionEmailInput["decision"] | null;
};

export const TRANSITIONS: Record<Exclude<VideoReviewAction, "ai_screen">, Transition> = {
  approve: { from: ["pending_review", "changes_requested"], to: "approved", notesRequired: false, email: "approved" },
  auto_approve: { from: ["pending_review"], to: "approved", notesRequired: false, email: "approved" },
  request_changes: { from: ["pending_review"], to: "changes_requested", notesRequired: true, email: "changes_requested" },
  reject: { from: ["pending_review", "changes_requested"], to: "rejected", notesRequired: true, email: "rejected" },
  unpublish: { from: ["approved"], to: "unpublished", notesRequired: true, email: "unpublished" },
  restore: { from: ["unpublished"], to: "approved", notesRequired: false, email: null },
};

export type ReviewAction = keyof typeof TRANSITIONS;

export type ReviewInput = {
  videoId: string;
  action: ReviewAction;
  /** Null for decisions made by the system (auto-approval, report threshold). */
  reviewerId: string | null;
  notes?: string | null;
  /** Set false to skip the creator email (e.g. a report-threshold hide awaiting review). */
  notifyCreator?: boolean;
};

/**
 * Apply one review decision. The status check and update are a single
 * conditional statement, so two reviewers acting at once can't both succeed.
 */
export async function applyReview(
  db: Database,
  input: ReviewInput,
  mailer: Mailer | null,
  now: Date = new Date(),
): Promise<{ video: Video; emailed: boolean }> {
  const rule = TRANSITIONS[input.action];
  const notes = input.notes?.trim() || null;
  if (rule.notesRequired && !notes) {
    throw new ModerationError("notes_required", "Please explain the decision; the creator will see it.");
  }

  const { video, reviewId } = await db.transaction(async (tx) => {
    const [before] = await tx.select({ status: videos.status }).from(videos).where(eq(videos.id, input.videoId));
    if (!before) throw new ModerationError("not_found", "Video not found.");

    const [updated] = await tx
      .update(videos)
      .set({
        status: rule.to,
        reviewDueAt: null,
        ...(rule.to === "approved" ? { publishedAt: sql`coalesce(${videos.publishedAt}, ${now.toISOString()}::timestamptz)` } : {}),
      })
      .where(and(eq(videos.id, input.videoId), inArray(videos.status, rule.from)))
      .returning();
    if (!updated) {
      throw new ModerationError(
        "invalid_transition",
        `Can't ${input.action.replace("_", " ")} a video that is ${before.status.replace("_", " ")}. It may have just been reviewed by someone else.`,
      );
    }
    const [review] = await tx
      .insert(videoReviews)
      .values({ videoId: updated.id, reviewerId: input.reviewerId, action: input.action, fromStatus: before.status, toStatus: rule.to, notes, createdAt: now })
      .returning({ id: videoReviews.id });
    return { video: updated, reviewId: review!.id };
  });

  let emailed = false;
  if (rule.email && mailer && input.notifyCreator !== false) {
    const [creator] = await db.select({ name: user.name, email: user.email }).from(user).where(eq(user.id, video.creatorId));
    if (creator) {
      try {
        await mailer.send({
          ...decisionEmail({ creatorName: creator.name, creatorEmail: creator.email, videoTitle: video.title, decision: rule.email, notes }),
          idempotencyKey: `video-review-${reviewId}`,
        });
        emailed = true;
      } catch (error) {
        // The decision stands; a failed notification is logged, not rolled back.
        console.error(`Review ${reviewId}: creator email failed`, error);
      }
    }
  }
  return { video, emailed };
}

export async function bulkApprove(
  db: Database,
  videoIds: string[],
  reviewerId: string,
  mailer: Mailer | null,
  now: Date = new Date(),
): Promise<{ approved: string[]; failed: { id: string; message: string }[] }> {
  const approved: string[] = [];
  const failed: { id: string; message: string }[] = [];
  for (const id of videoIds) {
    try {
      await applyReview(db, { videoId: id, action: "approve", reviewerId }, mailer, now);
      approved.push(id);
    } catch (error) {
      failed.push({ id, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { approved, failed };
}

// ---------------------------------------------------------------------------
// AI pre-screen
// ---------------------------------------------------------------------------

/** Transcript and frames for a video, from Cloudflare Stream in production. */
export interface MediaSource {
  requestCaptions(video: Video): Promise<void>;
  captionStatus(video: Video): Promise<"none" | "inprogress" | "ready" | "error">;
  captionVtt(video: Video): Promise<string>;
  frameUrls(video: Video): Promise<string[]>;
}

export type ScreenOutcome =
  | { state: "waiting_for_captions" }
  | { state: "screened"; decision: ReturnType<typeof decide> }
  | { state: "auto_approved"; decision: ReturnType<typeof decide> };

async function creatorHasHumanApproval(db: Database, creatorId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: videoReviews.id })
    .from(videoReviews)
    .innerJoin(videos, eq(videoReviews.videoId, videos.id))
    .where(and(eq(videos.creatorId, creatorId), eq(videoReviews.action, "approve"), isNotNull(videoReviews.reviewerId)))
    .limit(1);
  return Boolean(row);
}

/** Frame times for a video of `duration` seconds. */
export function frameTimes(durationSeconds: number | null): number[] {
  if (!durationSeconds || durationSeconds <= 0) return [1];
  return P.framePositions.map((p) => Math.round(durationSeconds * p));
}

/**
 * Screen one video. Waits (returns waiting_for_captions) until Stream's
 * captions are ready or captionWaitMinutes have passed; `force` screens now
 * with whatever is available (used by "re-run AI screen").
 */
export async function screenVideo(
  db: Database,
  videoId: string,
  deps: { media: MediaSource; screener: VideoScreener; mailer: Mailer | null },
  options: { force?: boolean; now?: Date } = {},
): Promise<ScreenOutcome> {
  const now = options.now ?? new Date();
  let [video] = await db.select().from(videos).where(eq(videos.id, videoId));
  if (!video) throw new ModerationError("not_found", "Video not found.");

  let transcript = video.transcript;
  if (!transcript && video.cloudflareUid) {
    if (!video.captionsRequestedAt) {
      try {
        await deps.media.requestCaptions(video);
      } catch (error) {
        console.error(`Video ${video.id}: caption request failed`, error);
      }
      [video] = await db.update(videos).set({ captionsRequestedAt: now }).where(eq(videos.id, video.id)).returning();
      if (!options.force) return { state: "waiting_for_captions" };
    }
    const status = await deps.media.captionStatus(video!).catch(() => "error" as const);
    if (status === "ready") {
      transcript = vttToText(await deps.media.captionVtt(video!)) || null;
      if (transcript) await db.update(videos).set({ transcript }).where(eq(videos.id, video!.id));
    } else {
      const waited = now.getTime() - (video!.captionsRequestedAt?.getTime() ?? now.getTime());
      if (!options.force && status !== "error" && waited < P.captionWaitMinutes * 60_000) return { state: "waiting_for_captions" };
    }
  }
  const current = video!;

  const frames = await deps.media.frameUrls(current).catch(() => []);
  const result: ScreenResult = await deps.screener.screen({
    type: current.type,
    title: current.title,
    description: current.description,
    category: current.category,
    tags: current.tags,
    durationSeconds: current.durationSeconds,
    transcript,
    frameUrls: frames,
  });
  const decision = decide({ type: current.type, result, creatorHasHumanApproval: await creatorHasHumanApproval(db, current.creatorId) });

  await db.transaction(async (tx) => {
    await tx
      .update(videos)
      .set({
        moderation: { ...result, autoApprovalBlockers: decision.reasons },
        screenedAt: now,
        aiRisk: decision.risk,
        aiRecommendation: result.kind === "screened" ? result.recommendation : "review",
      })
      .where(eq(videos.id, current.id));
    await tx.insert(videoReviews).values({
      videoId: current.id,
      action: "ai_screen",
      fromStatus: current.status,
      toStatus: current.status,
      notes:
        result.kind === "screened"
          ? `AI recommends ${result.recommendation} (${decision.risk} risk, relevance ${result.relevance}). ${result.recommendation_reason}`
          : "The AI declined to assess this video.",
      createdAt: now,
    });
  });

  if (decision.autoApprove && current.status === "pending_review") {
    await applyReview(
      db,
      { videoId: current.id, action: "auto_approve", reviewerId: null, notes: "Approved automatically after a clean AI screen." },
      deps.mailer,
      now,
    );
    return { state: "auto_approved", decision };
  }
  return { state: "screened", decision };
}

/** Screen every queued video that hasn't been screened. One failure doesn't stop the rest. */
export async function screenPendingVideos(
  db: Database,
  deps: { media: MediaSource; screener: VideoScreener; mailer: Mailer | null },
  now: Date = new Date(),
): Promise<{ screened: number; autoApproved: number; waiting: number; failed: { id: string; message: string }[] }> {
  const pending = await db
    .select({ id: videos.id })
    .from(videos)
    .where(and(eq(videos.status, "pending_review"), isNull(videos.screenedAt), isNotNull(videos.cloudflareUid)))
    .orderBy(asc(videos.createdAt));
  const summary = { screened: 0, autoApproved: 0, waiting: 0, failed: [] as { id: string; message: string }[] };
  for (const { id } of pending) {
    try {
      const outcome = await screenVideo(db, id, deps, { now });
      if (outcome.state === "waiting_for_captions") summary.waiting++;
      else if (outcome.state === "auto_approved") summary.autoApproved++;
      else summary.screened++;
    } catch (error) {
      summary.failed.push({ id, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

/**
 * A signed-in viewer reports a published video. Once enough different people
 * have open reports on it, it is hidden until an admin reviews it.
 */
export async function reportVideo(
  db: Database,
  input: { videoId: string; reporterId: string; reason: ReportReason; details?: string | null },
  now: Date = new Date(),
): Promise<{ alreadyReported: boolean; hidden: boolean }> {
  if (!(input.reason in REPORT_REASONS)) throw new ModerationError("not_reportable", "Choose a reason for the report.");
  const [video] = await db.select({ status: videos.status }).from(videos).where(eq(videos.id, input.videoId));
  if (!video || video.status !== "approved") throw new ModerationError("not_reportable", "This video can't be reported.");

  const inserted = await db
    .insert(contentReports)
    .values({ videoId: input.videoId, reporterId: input.reporterId, reason: input.reason, details: input.details?.trim() || null, createdAt: now })
    .onConflictDoNothing()
    .returning({ id: contentReports.id });
  if (inserted.length === 0) return { alreadyReported: true, hidden: false };

  const [{ reporters } = { reporters: 0 }] = await db
    .select({ reporters: sql<number>`count(distinct ${contentReports.reporterId})::int` })
    .from(contentReports)
    .where(and(eq(contentReports.videoId, input.videoId), eq(contentReports.status, "open")));

  if (reporters >= P.reportHideThreshold) {
    try {
      await applyReview(
        db,
        {
          videoId: input.videoId,
          action: "unpublish",
          reviewerId: null,
          notes: `Hidden automatically after ${reporters} reports. Awaiting review.`,
          notifyCreator: false,
        },
        null,
        now,
      );
      return { alreadyReported: false, hidden: true };
    } catch (error) {
      if (!(error instanceof ModerationError && error.reason === "invalid_transition")) throw error; // already hidden
    }
  }
  return { alreadyReported: false, hidden: false };
}

/** Close a video's open reports: "actioned" when the reports were right, "dismissed" otherwise. */
export async function resolveReports(
  db: Database,
  input: { videoId: string; reviewerId: string; outcome: "actioned" | "dismissed" },
  now: Date = new Date(),
): Promise<number> {
  const resolved = await db
    .update(contentReports)
    .set({ status: input.outcome, resolvedById: input.reviewerId, resolvedAt: now })
    .where(and(eq(contentReports.videoId, input.videoId), eq(contentReports.status, "open")))
    .returning({ id: contentReports.id });
  return resolved.length;
}

// ---------------------------------------------------------------------------
// Queues
// ---------------------------------------------------------------------------

export type QueueItem = {
  id: string;
  title: string;
  type: Video["type"];
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  creatorName: string;
  createdAt: Date;
  reviewDueAt: Date | null;
  sla: SlaState;
  screenedAt: Date | null;
  aiRisk: Video["aiRisk"];
  aiRecommendation: Video["aiRecommendation"];
  summary: string | null;
};

/** Videos waiting for a decision: urgent first, then high priority, then by deadline. */
export async function reviewQueue(db: Database, now: Date = new Date()): Promise<QueueItem[]> {
  const rows = await db
    .select({
      id: videos.id,
      title: videos.title,
      type: videos.type,
      durationSeconds: videos.durationSeconds,
      thumbnailUrl: videos.thumbnailUrl,
      creatorName: user.name,
      createdAt: videos.createdAt,
      reviewDueAt: videos.reviewDueAt,
      screenedAt: videos.screenedAt,
      aiRisk: videos.aiRisk,
      aiRecommendation: videos.aiRecommendation,
      summary: sql<string | null>`${videos.moderation}->>'summary'`,
    })
    .from(videos)
    .innerJoin(user, eq(videos.creatorId, user.id))
    .where(eq(videos.status, "pending_review"))
    .orderBy(
      sql`case when ${videos.aiRisk} = 'high' then 0 when ${videos.aiRisk} = 'medium' or ${videos.aiRecommendation} = 'reject' then 1 else 2 end`,
      sql`${videos.reviewDueAt} asc nulls last`,
      asc(videos.createdAt),
    );
  return rows.map((r) => ({ ...r, sla: slaState(r.reviewDueAt, now) }));
}

export type ReportedVideo = {
  id: string;
  title: string;
  status: VideoStatus;
  aiRisk: Video["aiRisk"];
  reporters: number;
  reasons: string[];
  details: string[];
  latestAt: Date;
};

/** Videos with open reports, most-reported first. */
export async function reportQueue(db: Database): Promise<ReportedVideo[]> {
  return db
    .select({
      id: videos.id,
      title: videos.title,
      status: videos.status,
      aiRisk: videos.aiRisk,
      reporters: sql<number>`count(distinct ${contentReports.reporterId})::int`,
      reasons: sql<string[]>`array_agg(distinct ${contentReports.reason})`,
      details: sql<string[]>`coalesce(array_agg(${contentReports.details}) filter (where ${contentReports.details} is not null), '{}')`,
      latestAt: sql<Date>`max(${contentReports.createdAt})`,
    })
    .from(contentReports)
    .innerJoin(videos, eq(contentReports.videoId, videos.id))
    .where(eq(contentReports.status, "open"))
    .groupBy(videos.id)
    .orderBy(sql`count(distinct ${contentReports.reporterId}) desc`, sql`max(${contentReports.createdAt}) desc`);
}

export async function moderationSummary(db: Database, now: Date = new Date()) {
  const [row] = await db.execute<{ pending: number; overdue: number; due_soon: number; awaiting_screen: number; changes_requested: number; open_reports: number }>(sql`
    select
      count(*) filter (where status = 'pending_review')::int as pending,
      count(*) filter (where status = 'pending_review' and review_due_at < ${now.toISOString()}::timestamptz)::int as overdue,
      count(*) filter (where status = 'pending_review' and review_due_at >= ${now.toISOString()}::timestamptz
        and review_due_at < ${new Date(now.getTime() + P.dueSoonHours * 3_600_000).toISOString()}::timestamptz)::int as due_soon,
      count(*) filter (where status = 'pending_review' and screened_at is null)::int as awaiting_screen,
      count(*) filter (where status = 'changes_requested')::int as changes_requested,
      (select count(distinct video_id)::int from content_reports where status = 'open') as open_reports
    from videos`);
  return {
    pending: row?.pending ?? 0,
    overdue: row?.overdue ?? 0,
    dueSoon: row?.due_soon ?? 0,
    awaitingScreen: row?.awaiting_screen ?? 0,
    changesRequested: row?.changes_requested ?? 0,
    openReports: row?.open_reports ?? 0,
  };
}

/** Everything a reviewer needs for one video. */
export async function reviewDetail(db: Database, videoId: string) {
  const [row] = await db
    .select({ video: videos, creatorName: user.name, creatorEmail: user.email })
    .from(videos)
    .innerJoin(user, eq(videos.creatorId, user.id))
    .where(eq(videos.id, videoId));
  if (!row) return null;

  const reviewer = sql<string | null>`(select name from "user" u where u.id = ${videoReviews.reviewerId})`;
  const [history, reports, placedThemes] = await Promise.all([
    db
      .select({ id: videoReviews.id, action: videoReviews.action, toStatus: videoReviews.toStatus, notes: videoReviews.notes, createdAt: videoReviews.createdAt, reviewer })
      .from(videoReviews)
      .where(eq(videoReviews.videoId, videoId))
      .orderBy(desc(videoReviews.createdAt)),
    db
      .select({ id: contentReports.id, reason: contentReports.reason, details: contentReports.details, status: contentReports.status, createdAt: contentReports.createdAt })
      .from(contentReports)
      .where(eq(contentReports.videoId, videoId))
      .orderBy(desc(contentReports.createdAt)),
    db
      .select({ name: themes.name, isPrimary: themeAssignments.isPrimary, confidence: themeAssignments.confidence })
      .from(themeAssignments)
      .innerJoin(themes, eq(themeAssignments.themeId, themes.id))
      .where(and(eq(themeAssignments.videoId, videoId), eq(themeAssignments.status, "active")))
      .orderBy(desc(themeAssignments.isPrimary)),
  ]);
  return {
    video: row.video,
    creator: { name: row.creatorName, email: row.creatorEmail },
    screen: (row.video.moderation as (ScreenResult & { autoApprovalBlockers?: string[] }) | null) ?? null,
    history,
    reports,
    themes: placedThemes,
  };
}
