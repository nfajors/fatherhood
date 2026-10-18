/**
 * Comments under videos and lessons (docs/development-plan.md 3.1 Community):
 * signed-in viewers who can watch a video can comment on it, with one level of
 * replies. Viewers report; enough reporters hide a comment until an admin
 * decides. Authors edit and delete their own.
 */
import { and, asc, count, desc, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth";
import type { Database } from "@/lib/db";
import { commentReports, comments, user, videos } from "@/lib/db/schema";
import { MODERATION_POLICY, REPORT_REASONS, type ReportReason } from "@/lib/moderation/policy";
import { accessFor, loadViewer } from "@/lib/playback/access";
import { reviewerName } from "@/lib/ratings/service";

export const COMMENT_POLICY = {
  minChars: 2,
  maxChars: 2000,
  /** Spam brake: at most this many comments per person per window. */
  rateLimit: { count: 5, windowMinutes: 10 },
  /** Top-level comments shown before "show more". */
  pageSize: 20,
} as const;

export class CommentError extends Error {
  constructor(
    readonly reason: "not_found" | "not_allowed" | "invalid" | "rate_limited" | "not_yours",
    message: string,
  ) {
    super(message);
    this.name = "CommentError";
  }
}

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

function cleanBody(body: string): string {
  const text = body.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length < COMMENT_POLICY.minChars) throw new CommentError("invalid", "Write a little more.");
  if (text.length > COMMENT_POLICY.maxChars) throw new CommentError("invalid", `Comments can be up to ${COMMENT_POLICY.maxChars} characters.`);
  return text;
}

/** Comments are open to signed-in viewers who can watch the video (so members only on paid lessons). */
export async function canComment(db: Database, sessionUser: SessionUser | null, videoId: string): Promise<boolean> {
  if (!sessionUser) return false;
  const video = await db.query.videos.findFirst({ where: eq(videos.id, videoId) });
  if (!video || video.status !== "approved") return false;
  return (await accessFor(db, video, await loadViewer(db, sessionUser))).allowed;
}

export async function postComment(
  db: Database,
  sessionUser: SessionUser,
  input: { videoId: string; body: string; parentId?: string | null },
  now: Date = new Date(),
) {
  const body = cleanBody(input.body);
  if (!(await canComment(db, sessionUser, input.videoId))) {
    throw new CommentError("not_allowed", "You can comment on videos you can watch.");
  }
  return db.transaction(async (tx) => {
    // Serialize one person's posts so the rate limit can't be raced.
    await tx.select({ id: user.id }).from(user).where(eq(user.id, sessionUser.id)).for("update");
    const since = new Date(now.getTime() - COMMENT_POLICY.rateLimit.windowMinutes * 60_000);
    const [recent] = await tx
      .select({ n: count() })
      .from(comments)
      .where(and(eq(comments.userId, sessionUser.id), gte(comments.createdAt, since)));
    if ((recent?.n ?? 0) >= COMMENT_POLICY.rateLimit.count) {
      throw new CommentError("rate_limited", "You're commenting quickly. Take a breath and try again in a few minutes.");
    }

    let parentId: string | null = null;
    if (input.parentId) {
      const [parent] = await tx.select().from(comments).where(eq(comments.id, input.parentId));
      if (!parent || parent.videoId !== input.videoId || parent.status !== "visible") {
        throw new CommentError("not_found", "That comment is no longer there.");
      }
      // One level of threading: a reply to a reply joins the same thread.
      parentId = parent.parentId ?? parent.id;
    }
    const [row] = await tx
      .insert(comments)
      .values({ videoId: input.videoId, userId: sessionUser.id, parentId, body, createdAt: now, updatedAt: now })
      .returning();
    return row!;
  });
}

async function ownComment(tx: Database | Transaction, userId: string, id: string) {
  const [row] = await tx.select().from(comments).where(eq(comments.id, id));
  if (!row || row.status === "removed") throw new CommentError("not_found", "Comment not found.");
  if (row.userId !== userId) throw new CommentError("not_yours", "You can only change your own comments.");
  return row;
}

export async function editComment(db: Database, userId: string, id: string, body: string, now: Date = new Date()) {
  const text = cleanBody(body);
  const row = await ownComment(db, userId, id);
  if (row.status !== "visible") throw new CommentError("not_allowed", "This comment is hidden while moderators review it.");
  const [updated] = await db.update(comments).set({ body: text, editedAt: now }).where(eq(comments.id, id)).returning();
  return updated!;
}

/** The author deletes their comment. Replies stay, under a "deleted" placeholder. */
export async function deleteOwnComment(db: Database, userId: string, id: string) {
  await ownComment(db, userId, id);
  await db.update(comments).set({ status: "removed", body: "" }).where(eq(comments.id, id));
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export type CommentView = {
  id: string;
  body: string;
  author: string;
  badge: "creator" | "team" | null;
  createdAt: Date;
  editedAt: Date | null;
  isOwn: boolean;
  /** Deleted, but kept as a placeholder because it has replies. */
  deleted: boolean;
  /** The viewer's own comment, hidden while moderators review it. */
  underReview: boolean;
  replies: CommentView[];
};

/**
 * A video's conversation, newest threads first, replies oldest first. Hidden
 * comments are left out, except that their authors see their own, marked as
 * under review.
 */
export async function listComments(
  db: Database,
  videoId: string,
  options: { viewerId?: string | null; limit?: number } = {},
): Promise<{ threads: CommentView[]; total: number; hasMore: boolean }> {
  const viewerId = options.viewerId ?? null;
  const limit = options.limit ?? COMMENT_POLICY.pageSize;
  const [video] = await db.select({ creatorId: videos.creatorId }).from(videos).where(eq(videos.id, videoId));
  if (!video) return { threads: [], total: 0, hasMore: false };

  const visibleOrOwn = viewerId
    ? sql`(${comments.status} = 'visible' or (${comments.status} = 'hidden' and ${comments.userId} = ${viewerId}))`
    : eq(comments.status, "visible");
  const fields = {
    id: comments.id,
    parentId: comments.parentId,
    userId: comments.userId,
    body: comments.body,
    status: comments.status,
    createdAt: comments.createdAt,
    editedAt: comments.editedAt,
    authorName: user.name,
    authorRole: user.role,
  };

  // Top-level: visible ones, plus deleted ones that still have visible replies.
  const hasVisibleReplies = sql`exists (select 1 from comments r where r.parent_id = "comments"."id" and r.status = 'visible')`;
  const topWhere = and(eq(comments.videoId, videoId), isNull(comments.parentId), sql`(${visibleOrOwn} or (${comments.status} = 'removed' and ${hasVisibleReplies}))`);
  const [tops, [total]] = await Promise.all([
    db.select(fields).from(comments).innerJoin(user, eq(comments.userId, user.id)).where(topWhere).orderBy(desc(comments.createdAt)).limit(limit + 1),
    db.select({ n: count() }).from(comments).where(and(eq(comments.videoId, videoId), eq(comments.status, "visible"))),
  ]);
  const page = tops.slice(0, limit);
  const replies = page.length
    ? await db
        .select(fields)
        .from(comments)
        .innerJoin(user, eq(comments.userId, user.id))
        .where(and(inArray(comments.parentId, page.map((t) => t.id)), visibleOrOwn))
        .orderBy(asc(comments.createdAt))
    : [];

  const view = (c: (typeof tops)[number]): CommentView => ({
    id: c.id,
    body: c.status === "removed" ? "" : c.body,
    author: c.status === "removed" ? "" : reviewerName(c.authorName),
    badge: c.userId === video.creatorId ? "creator" : c.authorRole === "admin" ? "team" : null,
    createdAt: c.createdAt,
    editedAt: c.editedAt,
    isOwn: c.userId === viewerId && c.status !== "removed",
    deleted: c.status === "removed",
    underReview: c.status === "hidden",
    replies: [],
  });
  return {
    threads: page.map((t) => ({ ...view(t), replies: replies.filter((r) => r.parentId === t.id).map(view) })),
    total: total?.n ?? 0,
    hasMore: tops.length > limit,
  };
}

// ---------------------------------------------------------------------------
// Reports and moderation
// ---------------------------------------------------------------------------

/** A viewer reports a comment. At the threshold of distinct reporters it is hidden pending review. */
export async function reportComment(
  db: Database,
  input: { commentId: string; reporterId: string; reason: ReportReason },
): Promise<{ alreadyReported: boolean; hidden: boolean }> {
  if (!(input.reason in REPORT_REASONS)) throw new CommentError("invalid", "Choose a reason.");
  return db.transaction(async (tx) => {
    const [comment] = await tx.select().from(comments).where(eq(comments.id, input.commentId)).for("update");
    if (!comment || comment.status === "removed") throw new CommentError("not_found", "Comment not found.");
    if (comment.userId === input.reporterId) throw new CommentError("not_allowed", "You can't report your own comment.");
    const [inserted] = await tx
      .insert(commentReports)
      .values({ commentId: comment.id, reporterId: input.reporterId, reason: input.reason })
      .onConflictDoNothing()
      .returning({ id: commentReports.id });
    const [open] = await tx
      .select({ n: sql<number>`count(distinct ${commentReports.reporterId})::int` })
      .from(commentReports)
      .where(and(eq(commentReports.commentId, comment.id), eq(commentReports.status, "open")));
    let hidden = comment.status === "hidden";
    if (!hidden && (open?.n ?? 0) >= MODERATION_POLICY.reportHideThreshold) {
      await tx.update(comments).set({ status: "hidden" }).where(eq(comments.id, comment.id));
      hidden = true;
    }
    return { alreadyReported: !inserted, hidden };
  });
}

export type CommentModeration = "hide" | "restore" | "remove";

/** An admin hides, restores or removes a comment; its open reports are resolved. */
export async function moderateComment(db: Database, id: string, action: CommentModeration, adminId: string, now: Date = new Date()) {
  await db.transaction(async (tx) => {
    const [row] = await tx.select({ id: comments.id }).from(comments).where(eq(comments.id, id)).for("update");
    if (!row) throw new CommentError("not_found", "Comment not found.");
    const status = action === "hide" ? "hidden" : action === "restore" ? "visible" : "removed";
    await tx
      .update(comments)
      .set({ status, ...(action === "remove" ? { body: "" } : {}) })
      .where(eq(comments.id, id));
    await tx
      .update(commentReports)
      .set({ status: action === "restore" ? "dismissed" : "actioned", resolvedById: adminId, resolvedAt: now })
      .where(and(eq(commentReports.commentId, id), eq(commentReports.status, "open")));
  });
}

/** For /admin/comments: reported and hidden first, then recent. */
export async function moderationList(db: Database, options: { filter?: "reported" | "recent"; limit?: number } = {}) {
  const openReports = sql<number>`(select count(*)::int from comment_reports cr where cr.comment_id = "comments"."id" and cr.status = 'open')`;
  const reasons = sql<string[]>`(select coalesce(array_agg(distinct cr.reason), '{}') from comment_reports cr where cr.comment_id = "comments"."id" and cr.status = 'open')`;
  return db
    .select({
      id: comments.id,
      body: comments.body,
      status: comments.status,
      createdAt: comments.createdAt,
      authorName: user.name,
      authorEmail: user.email,
      videoId: videos.id,
      videoTitle: videos.title,
      videoType: videos.type,
      openReports,
      reasons,
    })
    .from(comments)
    .innerJoin(user, eq(comments.userId, user.id))
    .innerJoin(videos, eq(comments.videoId, videos.id))
    .where(
      options.filter === "reported"
        ? sql`(${comments.status} = 'hidden' or ${openReports} > 0)`
        : ne(comments.status, "removed"),
    )
    .orderBy(...(options.filter === "reported" ? [sql`${openReports} desc`] : []), desc(comments.createdAt))
    .limit(options.limit ?? 100);
}

/** Visible comment counts per video, for cards and headings. */
export async function commentCounts(db: Database, videoIds: string[]): Promise<Map<string, number>> {
  if (videoIds.length === 0) return new Map();
  const rows = await db
    .select({ videoId: comments.videoId, n: count() })
    .from(comments)
    .where(and(inArray(comments.videoId, videoIds), eq(comments.status, "visible")))
    .groupBy(comments.videoId);
  return new Map(rows.map((r) => [r.videoId, r.n]));
}
