/**
 * Discussions: posts and replies (one level) in the main feed or a group, "me too"
 * reactions, follows, reports and moderation.
 *
 * Members, Fellows and admins post; anyone signed in reads. Each post is checked
 * by the AI before it appears (screen.ts): clear posts appear at once, others wait
 * for a moderator. Readers report; enough distinct reporters hide a post until a
 * moderator decides. Moderators are our admins, and per group, its moderators.
 */
import { and, count, desc, eq, gte, inArray, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth";
import type { Database } from "@/lib/db";
import { discussionGroupMembers, discussionGroups, follows, postReactions, postReports, posts, user, type PostStatus } from "@/lib/db/schema";
import { MODERATION_POLICY, REPORT_REASONS, type ReportReason } from "@/lib/moderation/policy";
import { isMember, loadViewer } from "@/lib/playback/access";
import { reviewerName } from "@/lib/ratings/service";
import { slugify } from "@/lib/slug";
import { DISCUSSION_POLICY as P, STARTER_GROUPS } from "./policy";
import type { PostScreener } from "./screen";

export class DiscussionError extends Error {
  constructor(
    readonly reason: "not_found" | "not_allowed" | "invalid" | "rate_limited" | "not_yours",
    message: string,
  ) {
    super(message);
  }
}

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Members (paid, gift or organization seat), Fellows and admins can post; everyone signed in can read. */
export async function canPost(db: Database, sessionUser: SessionUser | null): Promise<boolean> {
  if (!sessionUser) return false;
  if (sessionUser.role === "creator" || sessionUser.role === "admin") return true;
  return isMember(await loadViewer(db, sessionUser));
}

function cleanBody(body: string, isReply: boolean): string {
  const text = body.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const max = isReply ? P.maxReplyChars : P.maxPostChars;
  if (text.length < P.minChars) throw new DiscussionError("invalid", "Write a little more.");
  if (text.length > max) throw new DiscussionError("invalid", `${isReply ? "Replies" : "Posts"} can be up to ${max.toLocaleString("en-US")} characters.`);
  return text;
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

export type Group = typeof discussionGroups.$inferSelect;

export async function listGroups(db: Database, viewerId: string | null, options: { includeArchived?: boolean } = {}) {
  const memberCount = sql<number>`(select count(*)::int from discussion_group_members m where m.group_id = "discussion_groups"."id")`;
  const postCount = sql<number>`(select count(*)::int from posts p where p.group_id = "discussion_groups"."id" and p.parent_id is null and p.status = 'visible')`;
  const myRole = viewerId
    ? sql<"member" | "moderator" | null>`(select m.role from discussion_group_members m where m.group_id = "discussion_groups"."id" and m.user_id = ${viewerId})`
    : sql<null>`null`;
  return db
    .select({ id: discussionGroups.id, slug: discussionGroups.slug, name: discussionGroups.name, description: discussionGroups.description, status: discussionGroups.status, memberCount, postCount, myRole })
    .from(discussionGroups)
    .where(options.includeArchived ? undefined : eq(discussionGroups.status, "active"))
    .orderBy(discussionGroups.sortOrder, discussionGroups.name);
}

export async function getGroup(db: Database, slug: string) {
  return (await db.query.discussionGroups.findFirst({ where: eq(discussionGroups.slug, slug) })) ?? null;
}

export async function createGroup(db: Database, input: { name: string; description: string }) {
  const name = input.name.trim();
  const description = input.description.trim();
  if (name.length < 2 || description.length < 5) throw new DiscussionError("invalid", "Give the group a name and a short description.");
  const base = slugify(name) || "group";
  for (let n = 1; n < 20; n++) {
    const [row] = await db
      .insert(discussionGroups)
      .values({ slug: n === 1 ? base : `${base}-${n}`, name, description })
      .onConflictDoNothing({ target: discussionGroups.slug })
      .returning();
    if (row) return row;
  }
  throw new DiscussionError("invalid", "Try a different name.");
}

export async function updateGroup(db: Database, id: string, input: { name?: string; description?: string; status?: "active" | "archived"; sortOrder?: number }) {
  const [row] = await db.update(discussionGroups).set(input).where(eq(discussionGroups.id, id)).returning();
  if (!row) throw new DiscussionError("not_found", "Group not found.");
  return row;
}

/** The suggested set of groups; existing ones (by address) are left alone. */
export async function addStarterGroups(db: Database) {
  const rows = await db
    .insert(discussionGroups)
    .values(STARTER_GROUPS.map((g, i) => ({ ...g, sortOrder: i })))
    .onConflictDoNothing({ target: discussionGroups.slug })
    .returning({ id: discussionGroups.id });
  return rows.length;
}

export async function joinGroup(db: Database, userId: string, groupId: string) {
  const group = await db.query.discussionGroups.findFirst({ where: eq(discussionGroups.id, groupId) });
  if (!group || group.status !== "active") throw new DiscussionError("not_found", "Group not found.");
  await db.insert(discussionGroupMembers).values({ groupId, userId }).onConflictDoNothing();
}

export async function leaveGroup(db: Database, userId: string, groupId: string) {
  await db.delete(discussionGroupMembers).where(and(eq(discussionGroupMembers.groupId, groupId), eq(discussionGroupMembers.userId, userId)));
}

/** Make someone a group's moderator (joining them to it), or back to a member. */
export async function setGroupModerator(db: Database, input: { groupId: string; email: string; moderator: boolean }) {
  const person = await db.query.user.findFirst({ where: eq(user.email, input.email.trim().toLowerCase()), columns: { id: true } });
  if (!person) throw new DiscussionError("not_found", "No account has that email address.");
  const role = input.moderator ? "moderator" : "member";
  await db
    .insert(discussionGroupMembers)
    .values({ groupId: input.groupId, userId: person.id, role })
    .onConflictDoUpdate({ target: [discussionGroupMembers.groupId, discussionGroupMembers.userId], set: { role } });
}

export async function groupModerators(db: Database, groupId: string) {
  return db
    .select({ userId: user.id, name: user.name, email: user.email })
    .from(discussionGroupMembers)
    .innerJoin(user, eq(user.id, discussionGroupMembers.userId))
    .where(and(eq(discussionGroupMembers.groupId, groupId), eq(discussionGroupMembers.role, "moderator")));
}

/** Admins moderate everything; a group's moderators moderate its posts. */
async function canModerate(db: Database | Tx, actor: SessionUser, groupId: string | null): Promise<boolean> {
  if (actor.role === "admin") return true;
  if (!groupId) return false;
  const row = await db.query.discussionGroupMembers.findFirst({
    where: and(eq(discussionGroupMembers.groupId, groupId), eq(discussionGroupMembers.userId, actor.id), eq(discussionGroupMembers.role, "moderator")),
    columns: { userId: true },
  });
  return Boolean(row);
}

/** The groups this person moderates. */
export async function moderatedGroupIds(db: Database, userId: string): Promise<string[]> {
  const rows = await db
    .select({ id: discussionGroupMembers.groupId })
    .from(discussionGroupMembers)
    .where(and(eq(discussionGroupMembers.userId, userId), eq(discussionGroupMembers.role, "moderator")));
  return rows.map((r) => r.id);
}

// ---------------------------------------------------------------------------
// Posting
// ---------------------------------------------------------------------------

export type PostResult = { id: string; status: PostStatus; atRisk: boolean; parentId: string | null };

async function applyVerdict(db: Database, screener: PostScreener | null, post: { id: string; body: string; parentId: string | null; groupId: string | null }, now: Date) {
  if (!screener) {
    await db.update(posts).set({ status: "visible" }).where(eq(posts.id, post.id));
    return { status: "visible" as const, atRisk: false };
  }
  const [parent, group] = await Promise.all([
    post.parentId ? db.query.posts.findFirst({ where: eq(posts.id, post.parentId), columns: { body: true } }) : null,
    post.groupId ? db.query.discussionGroups.findFirst({ where: eq(discussionGroups.id, post.groupId), columns: { name: true } }) : null,
  ]);
  try {
    const verdict = await screener.screen({ body: post.body, isReply: Boolean(post.parentId), parentBody: parent?.body ?? null, group: group?.name ?? null });
    const status = verdict.publish ? ("visible" as const) : ("pending" as const);
    await db
      .update(posts)
      .set({ status, screenedAt: now, screenCategories: verdict.categories, screenReason: verdict.reason, screenAttempts: sql`${posts.screenAttempts} + 1` })
      .where(and(eq(posts.id, post.id), eq(posts.status, "pending")));
    return { status, atRisk: verdict.atRisk };
  } catch (error) {
    // Unchecked posts wait; the scheduled run tries again.
    console.error(`Post ${post.id}: AI check failed`, error);
    await db.update(posts).set({ screenAttempts: sql`${posts.screenAttempts} + 1` }).where(eq(posts.id, post.id));
    return { status: "pending" as const, atRisk: false };
  }
}

/** Post (or reply). Returns its status: visible, or pending when it's waiting for a moderator. */
export async function createPost(
  db: Database,
  screener: PostScreener | null,
  author: SessionUser,
  input: { body: string; groupId?: string | null; parentId?: string | null },
  now: Date = new Date(),
): Promise<PostResult> {
  if (!(await canPost(db, author))) throw new DiscussionError("not_allowed", "Posting is part of membership. You can still read everything.");
  const isReply = Boolean(input.parentId);
  const body = cleanBody(input.body, isReply);

  const created = await db.transaction(async (tx) => {
    // Serialize one person's posts so the rate limit can't be raced.
    await tx.select({ id: user.id }).from(user).where(eq(user.id, author.id)).for("update");
    const since = new Date(now.getTime() - P.rateLimit.windowMinutes * 60_000);
    const [recent] = await tx.select({ n: count() }).from(posts).where(and(eq(posts.authorId, author.id), gte(posts.createdAt, since)));
    if ((recent?.n ?? 0) >= P.rateLimit.count) throw new DiscussionError("rate_limited", "You're posting quickly. Take a breath and try again in a few minutes.");

    let parentId: string | null = null;
    let groupId = input.groupId ?? null;
    if (input.parentId) {
      const [parent] = await tx.select().from(posts).where(eq(posts.id, input.parentId));
      if (!parent || parent.status !== "visible") throw new DiscussionError("not_found", "That post is no longer there.");
      parentId = parent.parentId ?? parent.id;
      groupId = parent.groupId;
    } else if (groupId) {
      const [membership] = await tx
        .select({ status: discussionGroups.status })
        .from(discussionGroups)
        .innerJoin(discussionGroupMembers, and(eq(discussionGroupMembers.groupId, discussionGroups.id), eq(discussionGroupMembers.userId, author.id)))
        .where(eq(discussionGroups.id, groupId));
      if (!membership || membership.status !== "active") throw new DiscussionError("not_allowed", "Join the group to post in it.");
    }
    const [row] = await tx.insert(posts).values({ authorId: author.id, groupId, parentId, body, status: "pending", createdAt: now, updatedAt: now }).returning();
    return row!;
  });

  const { status, atRisk } = await applyVerdict(db, screener, created, now);
  return { id: created.id, status, atRisk, parentId: created.parentId };
}

async function ownPost(db: Database, userId: string, id: string) {
  const row = await db.query.posts.findFirst({ where: eq(posts.id, id) });
  if (!row || row.status === "removed") throw new DiscussionError("not_found", "Post not found.");
  if (row.authorId !== userId) throw new DiscussionError("not_yours", "You can only change your own posts.");
  return row;
}

/** Edit your own post; it's checked again, so an edit can send it back for review. */
export async function editPost(db: Database, screener: PostScreener | null, userId: string, id: string, body: string, now: Date = new Date()) {
  const row = await ownPost(db, userId, id);
  if (row.status === "hidden") throw new DiscussionError("not_allowed", "This post is hidden while moderators review it.");
  const text = cleanBody(body, Boolean(row.parentId));
  await db.update(posts).set({ body: text, editedAt: now, status: "pending", screenedAt: null, screenCategories: [], screenReason: null }).where(eq(posts.id, id));
  return applyVerdict(db, screener, { ...row, body: text }, now);
}

/** The author deletes his post. Replies stay, under a "deleted" placeholder. */
export async function deleteOwnPost(db: Database, userId: string, id: string) {
  await ownPost(db, userId, id);
  await db.update(posts).set({ status: "removed", body: "" }).where(eq(posts.id, id));
}

/** The scheduled run: check posts whose AI check failed or hasn't run. Returns replies that became visible. */
export async function screenPendingPosts(db: Database, screener: PostScreener | null, now: Date = new Date()) {
  const due = await db
    .select()
    .from(posts)
    .where(and(eq(posts.status, "pending"), isNull(posts.screenedAt), lt(posts.screenAttempts, P.screen.maxAttempts)))
    .orderBy(posts.createdAt)
    .limit(50);
  const published: string[] = [];
  for (const post of due) {
    const { status } = await applyVerdict(db, screener, post, now);
    if (status === "visible" && post.parentId) published.push(post.id);
  }
  return { checked: due.length, publishedReplies: published };
}

// ---------------------------------------------------------------------------
// Reactions, follows, reports
// ---------------------------------------------------------------------------

/** "Me too", on or off. Members and readers alike can react to others' visible posts. */
export async function toggleReaction(db: Database, userId: string, postId: string): Promise<{ reacted: boolean; count: number }> {
  const post = await db.query.posts.findFirst({ where: eq(posts.id, postId), columns: { status: true, authorId: true } });
  if (!post || post.status !== "visible") throw new DiscussionError("not_found", "Post not found.");
  if (post.authorId === userId) throw new DiscussionError("not_allowed", "You can't react to your own post.");
  const removed = await db.delete(postReactions).where(and(eq(postReactions.postId, postId), eq(postReactions.userId, userId))).returning({ postId: postReactions.postId });
  if (removed.length === 0) await db.insert(postReactions).values({ postId, userId }).onConflictDoNothing();
  const [row] = await db.select({ n: count() }).from(postReactions).where(eq(postReactions.postId, postId));
  return { reacted: removed.length === 0, count: row?.n ?? 0 };
}

export async function follow(db: Database, followerId: string, followeeId: string) {
  if (followerId === followeeId) throw new DiscussionError("invalid", "You can't follow yourself.");
  const exists = await db.query.user.findFirst({ where: eq(user.id, followeeId), columns: { id: true } });
  if (!exists) throw new DiscussionError("not_found", "Person not found.");
  await db.insert(follows).values({ followerId, followeeId }).onConflictDoNothing();
}

export async function unfollow(db: Database, followerId: string, followeeId: string) {
  await db.delete(follows).where(and(eq(follows.followerId, followerId), eq(follows.followeeId, followeeId)));
}

/** A reader reports a post. At the threshold of distinct reporters it's hidden until a moderator decides. */
export async function reportPost(db: Database, input: { postId: string; reporterId: string; reason: ReportReason }) {
  if (!(input.reason in REPORT_REASONS)) throw new DiscussionError("invalid", "Choose a reason.");
  return db.transaction(async (tx) => {
    const [post] = await tx.select().from(posts).where(eq(posts.id, input.postId)).for("update");
    if (!post || post.status === "removed" || post.status === "pending") throw new DiscussionError("not_found", "Post not found.");
    if (post.authorId === input.reporterId) throw new DiscussionError("not_allowed", "You can't report your own post.");
    const [inserted] = await tx.insert(postReports).values({ postId: post.id, reporterId: input.reporterId, reason: input.reason }).onConflictDoNothing().returning({ id: postReports.id });
    const [open] = await tx
      .select({ n: sql<number>`count(distinct ${postReports.reporterId})::int` })
      .from(postReports)
      .where(and(eq(postReports.postId, post.id), eq(postReports.status, "open")));
    let hidden = post.status === "hidden";
    if (!hidden && (open?.n ?? 0) >= MODERATION_POLICY.reportHideThreshold) {
      await tx.update(posts).set({ status: "hidden" }).where(eq(posts.id, post.id));
      hidden = true;
    }
    return { alreadyReported: !inserted, hidden };
  });
}

export type PostModeration = "approve" | "hide" | "restore" | "remove";

/**
 * A moderator approves a held post, hides or restores one, or removes it. Open
 * reports are resolved. Returns the post's new status and whether a reply just
 * became visible (so its thread's author can be told).
 */
export async function moderatePost(db: Database, actor: SessionUser, postId: string, action: PostModeration, now: Date = new Date()) {
  return db.transaction(async (tx) => {
    const [post] = await tx.select().from(posts).where(eq(posts.id, postId)).for("update");
    if (!post) throw new DiscussionError("not_found", "Post not found.");
    if (!(await canModerate(tx, actor, post.groupId))) throw new DiscussionError("not_allowed", "Only moderators can do that.");
    const allowed: Record<PostModeration, PostStatus[]> = { approve: ["pending"], hide: ["visible", "pending"], restore: ["hidden"], remove: ["pending", "visible", "hidden"] };
    if (!allowed[action].includes(post.status)) throw new DiscussionError("not_allowed", "That doesn't apply to this post now.");
    const status: PostStatus = action === "approve" || action === "restore" ? "visible" : action === "hide" ? "hidden" : "removed";
    await tx
      .update(posts)
      .set({ status, reviewedById: actor.id, reviewedAt: now, ...(action === "remove" ? { body: "" } : {}) })
      .where(eq(posts.id, postId));
    await tx
      .update(postReports)
      .set({ status: action === "approve" || action === "restore" ? "dismissed" : "actioned", resolvedById: actor.id, resolvedAt: now })
      .where(and(eq(postReports.postId, postId), eq(postReports.status, "open")));
    return { status, replyBecameVisible: status === "visible" && Boolean(post.parentId) };
  });
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export type PostView = {
  id: string;
  body: string;
  author: { id: string; name: string; badge: "fellow" | "team" | null };
  group: { slug: string; name: string } | null;
  createdAt: Date;
  editedAt: Date | null;
  meToo: number;
  reacted: boolean;
  replyCount: number;
  isOwn: boolean;
  /** The viewer's own post, waiting for a moderator. */
  pending: boolean;
  /** The viewer's own post, hidden while moderators review reports. */
  hidden: boolean;
  /** Deleted, kept as a placeholder because it has replies. */
  deleted: boolean;
};

const badgeOf = (role: string): PostView["author"]["badge"] => (role === "creator" ? "fellow" : role === "admin" ? "team" : null);

function fields(viewerId: string | null) {
  return {
    id: posts.id,
    body: posts.body,
    status: posts.status,
    authorId: posts.authorId,
    authorName: user.name,
    authorRole: user.role,
    groupSlug: discussionGroups.slug,
    groupName: discussionGroups.name,
    parentId: posts.parentId,
    createdAt: posts.createdAt,
    editedAt: posts.editedAt,
    meToo: sql<number>`(select count(*)::int from post_reactions r where r.post_id = "posts"."id")`,
    reacted: viewerId ? sql<boolean>`exists (select 1 from post_reactions r where r.post_id = "posts"."id" and r.user_id = ${viewerId})` : sql<boolean>`false`,
    replyCount: sql<number>`(select count(*)::int from posts c where c.parent_id = "posts"."id" and c.status = 'visible')`,
  };
}

type Row = { id: string; body: string; status: PostStatus; authorId: string; authorName: string; authorRole: string; groupSlug: string | null; groupName: string | null; createdAt: Date; editedAt: Date | null; meToo: number; reacted: boolean; replyCount: number };

function toView(r: Row, viewerId: string | null): PostView {
  const deleted = r.status === "removed";
  return {
    id: r.id,
    body: deleted ? "" : r.body,
    author: { id: r.authorId, name: deleted ? "" : reviewerName(r.authorName), badge: deleted ? null : badgeOf(r.authorRole) },
    group: r.groupSlug && r.groupName ? { slug: r.groupSlug, name: r.groupName } : null,
    createdAt: r.createdAt,
    editedAt: r.editedAt,
    meToo: r.meToo,
    reacted: r.reacted,
    replyCount: r.replyCount,
    isOwn: r.authorId === viewerId && !deleted,
    pending: r.status === "pending",
    hidden: r.status === "hidden",
    deleted,
  };
}

/** Visible posts, plus the viewer's own that are waiting or hidden (marked). */
const visibleOrOwn = (viewerId: string | null): SQL =>
  viewerId ? sql`(${posts.status} = 'visible' or (${posts.status} in ('pending', 'hidden') and ${posts.authorId} = ${viewerId}))` : sql`${posts.status} = 'visible'`;

export type FeedScope = { kind: "all" } | { kind: "following" } | { kind: "group"; groupId: string } | { kind: "person"; userId: string };

/** Top-level posts, newest first, in pages ("before" is the oldest createdAt already shown). */
export async function listFeed(db: Database, input: { viewerId: string | null; scope: FeedScope; before?: Date | null; limit?: number }) {
  const limit = input.limit ?? P.pageSize;
  const scope: SQL | undefined = {
    all: () => or(isNull(posts.groupId), eq(discussionGroups.status, "active")),
    following: () => (input.viewerId ? sql`${posts.authorId} in (select f.followee_id from follows f where f.follower_id = ${input.viewerId})` : sql`false`),
    group: () => eq(posts.groupId, (input.scope as { groupId: string }).groupId),
    person: () => eq(posts.authorId, (input.scope as { userId: string }).userId),
  }[input.scope.kind]();
  const rows = await db
    .select(fields(input.viewerId))
    .from(posts)
    .innerJoin(user, eq(user.id, posts.authorId))
    .leftJoin(discussionGroups, eq(discussionGroups.id, posts.groupId))
    .where(and(isNull(posts.parentId), visibleOrOwn(input.viewerId), scope, input.before ? lt(posts.createdAt, input.before) : undefined))
    .orderBy(desc(posts.createdAt))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  return { posts: page.map((r) => toView(r, input.viewerId)), nextBefore: rows.length > limit ? page.at(-1)!.createdAt : null };
}

/** A post and its replies (oldest first). Null if it isn't there for this viewer. */
export async function getThread(db: Database, postId: string, viewer: SessionUser | null) {
  const viewerId = viewer?.id ?? null;
  const hasVisibleReplies = sql`exists (select 1 from posts c where c.parent_id = "posts"."id" and c.status = 'visible')`;
  const [top] = await db
    .select({ ...fields(viewerId), groupId: posts.groupId })
    .from(posts)
    .innerJoin(user, eq(user.id, posts.authorId))
    .leftJoin(discussionGroups, eq(discussionGroups.id, posts.groupId))
    .where(and(eq(posts.id, postId), isNull(posts.parentId), sql`(${visibleOrOwn(viewerId)} or (${posts.status} = 'removed' and ${hasVisibleReplies}))`));
  if (!top) return null;
  const replies = await db
    .select(fields(viewerId))
    .from(posts)
    .innerJoin(user, eq(user.id, posts.authorId))
    .leftJoin(discussionGroups, eq(discussionGroups.id, posts.groupId))
    .where(and(eq(posts.parentId, postId), visibleOrOwn(viewerId)))
    .orderBy(posts.createdAt);
  return {
    post: toView(top, viewerId),
    groupId: top.groupId,
    replies: replies.map((r) => toView(r, viewerId)),
    canModerate: viewer ? await canModerate(db, viewer, top.groupId) : false,
  };
}

/** A person's page: name, badge, follows, and whether the viewer follows them. */
export async function personProfile(db: Database, userId: string, viewerId: string | null) {
  const person = await db.query.user.findFirst({ where: eq(user.id, userId), columns: { id: true, name: true, role: true } });
  if (!person) return null;
  const [[followers], [following], isFollowing] = await Promise.all([
    db.select({ n: count() }).from(follows).where(eq(follows.followeeId, userId)),
    db.select({ n: count() }).from(follows).where(eq(follows.followerId, userId)),
    viewerId ? db.query.follows.findFirst({ where: and(eq(follows.followerId, viewerId), eq(follows.followeeId, userId)) }) : null,
  ]);
  return { id: person.id, name: reviewerName(person.name), badge: badgeOf(person.role), followers: followers?.n ?? 0, following: following?.n ?? 0, isFollowing: Boolean(isFollowing) };
}

/**
 * What moderators need to look at: posts held by the AI check (or not checked yet),
 * and posts reported or hidden. Admins see everything; group moderators their groups.
 */
export async function moderationQueue(db: Database, actor: SessionUser) {
  const groupIds = actor.role === "admin" ? null : await moderatedGroupIds(db, actor.id);
  const scope = groupIds === null ? undefined : groupIds.length ? inArray(posts.groupId, groupIds) : sql`false`;
  const openReports = sql<number>`(select count(*)::int from post_reports r where r.post_id = "posts"."id" and r.status = 'open')`;
  const reasons = sql<string[]>`(select coalesce(array_agg(distinct r.reason), '{}') from post_reports r where r.post_id = "posts"."id" and r.status = 'open')`;
  return db
    .select({
      id: posts.id,
      body: posts.body,
      status: posts.status,
      createdAt: posts.createdAt,
      parentId: posts.parentId,
      parentBody: sql<string | null>`(select p.body from posts p where p.id = "posts"."parent_id")`,
      screenedAt: posts.screenedAt,
      screenCategories: posts.screenCategories,
      screenReason: posts.screenReason,
      authorName: user.name,
      authorEmail: user.email,
      groupName: discussionGroups.name,
      openReports,
      reasons,
    })
    .from(posts)
    .innerJoin(user, eq(user.id, posts.authorId))
    .leftJoin(discussionGroups, eq(discussionGroups.id, posts.groupId))
    .where(and(or(eq(posts.status, "pending"), eq(posts.status, "hidden"), sql`${openReports} > 0`), ne(posts.status, "removed"), scope))
    .orderBy(desc(sql`${posts.status} = 'pending'`), desc(openReports), posts.createdAt)
    .limit(200);
}
