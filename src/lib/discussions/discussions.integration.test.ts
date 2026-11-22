/**
 * Discussions against a real Postgres, with a fake AI check: who can post, the
 * check, groups, threads, reactions, follows, reports, moderation and reply
 * emails. Runs only when TEST_DATABASE_URL points at a disposable database.
 */
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "@/lib/auth";
import type { Database } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import type { EmailMessage, Mailer } from "@/lib/email";
import { notifyPostReply } from "./emails";
import type { PostScreener, ScreenVerdict } from "./screen";
import { toVerdict } from "./screen";
import {
  addStarterGroups,
  canPost,
  createPost,
  deleteOwnPost,
  DiscussionError,
  editPost,
  follow,
  getThread,
  joinGroup,
  listFeed,
  listGroups,
  moderatePost,
  moderationQueue,
  personProfile,
  reportPost,
  screenPendingPosts,
  setGroupModerator,
  toggleReaction,
  updateGroup,
} from "./service";

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-22T15:00:00Z");
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

const person = (id: string, role: SessionUser["role"] = "user"): SessionUser => ({ id, email: `${id}@test.dev`, name: `${id[0]!.toUpperCase()}${id.slice(1)} Smith`, role, stripeCustomerId: null });
const member = person("marcus");
const other = person("sam");
const reader = person("free");
const fellow = person("james", "creator");
const admin = person("ada", "admin");

class FakeScreener implements PostScreener {
  calls: string[] = [];
  fail = false;
  async screen({ body }: { body: string }): Promise<ScreenVerdict> {
    this.calls.push(body);
    if (this.fail) throw new Error("timeout");
    if (body.includes("HOLD")) return { publish: false, categories: ["harassment_or_hate"], reason: "Insults another member.", atRisk: false };
    if (body.includes("HURT")) return { publish: false, categories: ["self_harm"], reason: "Writer may be at risk.", atRisk: true };
    return { publish: true, categories: [], reason: "Fine.", atRisk: false };
  }
}

class RecordingMailer implements Mailer {
  sent: EmailMessage[] = [];
  async send(m: EmailMessage) {
    this.sent.push(m);
  }
}

describe("toVerdict", () => {
  it("holds anything flagged, maps unknown categories, and marks danger", () => {
    expect(toVerdict({ flags: [], publish: true, reason: " ok ", at_risk: false })).toEqual({ publish: true, categories: [], reason: "ok", atRisk: false });
    expect(toVerdict({ flags: [{ category: "spam_or_scam", explanation: "" }], publish: true, reason: "", at_risk: false })).toMatchObject({ publish: false, categories: ["spam_or_scam"] });
    expect(toVerdict({ flags: [{ category: "weird", explanation: "" }], publish: false, reason: "", at_risk: false }).categories).toEqual(["other"]);
    expect(toVerdict({ flags: [{ category: "self_harm", explanation: "" }], publish: false, reason: "", at_risk: false }).atRisk).toBe(true);
  });
});

describe.skipIf(!url)("discussions (Postgres)", () => {
  let client: postgres.Sql;
  let db: Database;
  let screener: FakeScreener;

  beforeAll(async () => {
    process.env.EMAIL_TOKEN_SECRET ??= "test-email-token-secret";
    client = postgres(url!, { max: 4, onnotice: () => {} });
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: "drizzle" });
  });

  afterAll(async () => {
    await client?.end();
  });

  beforeEach(async () => {
    await db.execute(sql`truncate posts, post_reactions, post_reports, follows, discussion_group_members, discussion_groups, email_sends, email_preferences, subscriptions, "user" cascade`);
    for (const p of [member, other, reader, fellow, admin]) await db.insert(schema.user).values({ id: p.id, name: p.name, email: p.email, role: p.role });
    await db.insert(schema.subscriptions).values([
      { userId: "marcus", plan: "monthly", status: "active", currentPeriodEnd: later(60 * 24 * 30) },
      { userId: "sam", plan: "annual", status: "active", currentPeriodEnd: later(60 * 24 * 30) },
    ]);
    screener = new FakeScreener();
  });

  const status = async (id: string) => (await db.query.posts.findFirst({ where: eq(schema.posts.id, id) }))!.status;

  it("lets members, Fellows and admins post; free accounts only read", async () => {
    expect(await canPost(db, member)).toBe(true);
    expect(await canPost(db, fellow)).toBe(true);
    expect(await canPost(db, admin)).toBe(true);
    expect(await canPost(db, reader)).toBe(false);
    expect(await canPost(db, null)).toBe(false);
    await expect(createPost(db, screener, reader, { body: "Hello everyone" }, NOW)).rejects.toMatchObject({ reason: "not_allowed" });
  });

  it("shows a clear post at once, and holds a flagged one for moderators, visible only to its author", async () => {
    const ok = await createPost(db, screener, member, { body: "First week back at work after the baby. How do you all manage?" }, NOW);
    expect(ok).toMatchObject({ status: "visible", atRisk: false });
    const held = await createPost(db, screener, member, { body: "HOLD you're all idiots" }, later(1));
    expect(held).toMatchObject({ status: "pending" });
    const risk = await createPost(db, screener, member, { body: "HURT I can't do this anymore" }, later(2));
    expect(risk).toMatchObject({ status: "pending", atRisk: true });

    expect((await listFeed(db, { viewerId: "sam", scope: { kind: "all" } })).posts.map((p) => p.body)).toEqual([expect.stringContaining("First week")]);
    const mine = (await listFeed(db, { viewerId: "marcus", scope: { kind: "all" } })).posts;
    expect(mine.map((p) => [p.pending, p.isOwn])).toEqual([[true, true], [true, true], [false, true]]);
    const row = await db.query.posts.findFirst({ where: eq(schema.posts.id, held.id) });
    expect(row).toMatchObject({ screenCategories: ["harassment_or_hate"], screenReason: "Insults another member." });
  });

  it("publishes at once without an AI check, and retries a failed check later", async () => {
    expect((await createPost(db, null, member, { body: "No AI configured here" }, NOW)).status).toBe("visible");
    screener.fail = true;
    const failed = await createPost(db, screener, member, { body: "This one waits" }, later(1));
    expect(failed.status).toBe("pending");
    screener.fail = false;
    expect(await screenPendingPosts(db, screener, later(10))).toEqual({ checked: 1, publishedReplies: [] });
    expect(await status(failed.id)).toBe("visible");
  });

  it("slows down fast posting", async () => {
    for (let i = 0; i < 6; i++) await createPost(db, null, member, { body: `post ${i}` }, later(i));
    await expect(createPost(db, null, member, { body: "one more" }, later(7))).rejects.toMatchObject({ reason: "rate_limited" });
    await createPost(db, null, member, { body: "after a break" }, later(20));
  });

  it("needs joining a group to post in it, keeps replies in the thread's group, and flattens reply chains", async () => {
    await addStarterGroups(db);
    const groups = await listGroups(db, "marcus");
    expect(groups.map((g) => g.slug)).toContain("co-parenting");
    const coparenting = groups.find((g) => g.slug === "co-parenting")!;
    await expect(createPost(db, null, member, { body: "Holidays across two homes", groupId: coparenting.id }, NOW)).rejects.toThrow("Join the group");
    await joinGroup(db, "marcus", coparenting.id);
    const top = await createPost(db, null, member, { body: "Holidays across two homes", groupId: coparenting.id }, NOW);

    // Anyone who can post may reply, joined or not; the reply stays in the group's thread.
    const reply = await createPost(db, null, other, { body: "We alternate years", parentId: top.id }, later(1));
    const replyToReply = await createPost(db, null, member, { body: "That's fair", parentId: reply.id }, later(2));
    expect(replyToReply.parentId).toBe(top.id);
    const thread = (await getThread(db, top.id, other))!;
    expect(thread.post).toMatchObject({ group: { slug: "co-parenting", name: "Co-parenting" }, replyCount: 2 });
    expect(thread.replies.map((r) => r.body)).toEqual(["We alternate years", "That's fair"]);
    expect((await listFeed(db, { viewerId: null, scope: { kind: "group", groupId: coparenting.id } })).posts).toHaveLength(1);
    expect((await listGroups(db, "marcus")).find((g) => g.slug === "co-parenting")).toMatchObject({ memberCount: 1, postCount: 1, myRole: "member" });

    // An archived group's posts leave the main feed.
    await updateGroup(db, coparenting.id, { status: "archived" });
    expect((await listFeed(db, { viewerId: "sam", scope: { kind: "all" } })).posts).toHaveLength(0);
  });

  it("re-checks an edit, and keeps a deleted post with replies as a placeholder", async () => {
    const post = await createPost(db, screener, member, { body: "Looking for advice on bedtime" }, NOW);
    expect((await editPost(db, screener, "marcus", post.id, "HOLD edited to be rude", later(1))).status).toBe("pending");
    await expect(editPost(db, screener, "sam", post.id, "not mine")).rejects.toMatchObject({ reason: "not_yours" });
    await editPost(db, screener, "marcus", post.id, "Looking for advice on bedtime, again", later(2));
    await createPost(db, null, other, { body: "Same order every night", parentId: post.id }, later(3));
    await deleteOwnPost(db, "marcus", post.id);
    const thread = (await getThread(db, post.id, other))!;
    expect(thread.post).toMatchObject({ deleted: true, body: "", author: { name: "" } });
    expect(thread.replies).toHaveLength(1);
  });

  it("counts 'me too', not on your own post", async () => {
    const post = await createPost(db, null, member, { body: "Anyone else not sleeping?" }, NOW);
    expect(await toggleReaction(db, "sam", post.id)).toEqual({ reacted: true, count: 1 });
    expect(await toggleReaction(db, "free", post.id)).toEqual({ reacted: true, count: 2 });
    expect(await toggleReaction(db, "sam", post.id)).toEqual({ reacted: false, count: 1 });
    await expect(toggleReaction(db, "marcus", post.id)).rejects.toBeInstanceOf(DiscussionError);
    const [view] = (await listFeed(db, { viewerId: "free", scope: { kind: "all" } })).posts;
    expect(view).toMatchObject({ meToo: 1, reacted: true });
  });

  it("follows people and builds a following feed", async () => {
    await createPost(db, null, member, { body: "From Marcus" }, NOW);
    await createPost(db, null, fellow, { body: "From James" }, later(1));
    await follow(db, "free", "james");
    await expect(follow(db, "free", "free")).rejects.toMatchObject({ reason: "invalid" });
    expect((await listFeed(db, { viewerId: "free", scope: { kind: "following" } })).posts.map((p) => [p.body, p.author.badge])).toEqual([["From James", "fellow"]]);
    expect(await personProfile(db, "james", "free")).toEqual({ id: "james", name: "James S.", badge: "fellow", followers: 1, following: 0, isFollowing: true });
    expect((await listFeed(db, { viewerId: null, scope: { kind: "person", userId: "marcus" } })).posts.map((p) => p.body)).toEqual(["From Marcus"]);
  });

  it("pages the feed", async () => {
    for (let i = 0; i < 5; i++) await createPost(db, null, fellow, { body: `post ${i}` }, later(i * 20));
    const first = await listFeed(db, { viewerId: null, scope: { kind: "all" }, limit: 3 });
    expect(first.posts.map((p) => p.body)).toEqual(["post 4", "post 3", "post 2"]);
    const second = await listFeed(db, { viewerId: null, scope: { kind: "all" }, limit: 3, before: first.nextBefore });
    expect(second.posts.map((p) => p.body)).toEqual(["post 1", "post 0"]);
    expect(second.nextBefore).toBeNull();
  });

  it("hides a post at three reporters, until a moderator restores or removes it", async () => {
    const post = await createPost(db, null, member, { body: "Something people object to" }, NOW);
    await expect(reportPost(db, { postId: post.id, reporterId: "marcus", reason: "spam" })).rejects.toMatchObject({ reason: "not_allowed" });
    await reportPost(db, { postId: post.id, reporterId: "sam", reason: "spam" });
    expect(await reportPost(db, { postId: post.id, reporterId: "sam", reason: "spam" })).toEqual({ alreadyReported: true, hidden: false });
    await reportPost(db, { postId: post.id, reporterId: "free", reason: "harassment_or_hate" });
    expect(await reportPost(db, { postId: post.id, reporterId: "james", reason: "spam" })).toEqual({ alreadyReported: false, hidden: true });
    expect(await status(post.id)).toBe("hidden");
    expect((await moderationQueue(db, admin)).map((q) => [q.id, q.openReports])).toEqual([[post.id, 3]]);
    await moderatePost(db, admin, post.id, "restore", later(5));
    expect(await status(post.id)).toBe("visible");
    expect(await moderationQueue(db, admin)).toEqual([]);
  });

  it("lets group moderators act only in their group, and admins everywhere", async () => {
    await addStarterGroups(db);
    const [teens, dads] = await Promise.all([db.query.discussionGroups.findFirst({ where: eq(schema.discussionGroups.slug, "teens") }), db.query.discussionGroups.findFirst({ where: eq(schema.discussionGroups.slug, "new-dads") })]);
    await setGroupModerator(db, { groupId: teens!.id, email: "james@test.dev", moderator: true });
    await joinGroup(db, "marcus", teens!.id);
    await joinGroup(db, "marcus", dads!.id);
    const inTeens = await createPost(db, screener, member, { body: "HOLD in teens", groupId: teens!.id }, NOW);
    const inDads = await createPost(db, screener, member, { body: "HOLD in new dads", groupId: dads!.id }, later(1));
    const inFeed = await createPost(db, screener, member, { body: "HOLD in the feed" }, later(2));

    expect((await moderationQueue(db, fellow)).map((q) => q.id)).toEqual([inTeens.id]);
    expect((await moderationQueue(db, admin)).map((q) => q.id).sort()).toEqual([inTeens.id, inDads.id, inFeed.id].sort());
    expect(await moderationQueue(db, other)).toEqual([]);

    expect(await moderatePost(db, fellow, inTeens.id, "approve", later(3))).toEqual({ status: "visible", replyBecameVisible: false });
    await expect(moderatePost(db, fellow, inDads.id, "approve")).rejects.toMatchObject({ reason: "not_allowed" });
    await expect(moderatePost(db, fellow, inFeed.id, "remove")).rejects.toMatchObject({ reason: "not_allowed" });
    await moderatePost(db, admin, inFeed.id, "remove", later(4));
    expect(await status(inFeed.id)).toBe("removed");
    await expect(moderatePost(db, admin, inFeed.id, "approve")).rejects.toThrow("doesn't apply");
    expect((await getThread(db, inTeens.id, fellow))?.canModerate).toBe(true);
    expect((await getThread(db, inTeens.id, other))?.canModerate).toBe(false);
  });

  it("emails the thread's author about a reply, once in a while, and not about his own", async () => {
    const mailer = new RecordingMailer();
    const top = await createPost(db, null, member, { body: "Bedtime is a battle" }, NOW);
    const own = await createPost(db, null, member, { body: "Update: better tonight", parentId: top.id }, later(1));
    expect(await notifyPostReply(db, mailer, own.id, { appUrl: "https://fs.test", now: later(1) })).toEqual({ sent: false, reason: "own_thread" });

    const reply = await createPost(db, null, other, { body: "Same order every night", parentId: top.id }, later(2));
    expect(await notifyPostReply(db, mailer, reply.id, { appUrl: "https://fs.test", now: later(2) })).toEqual({ sent: true });
    expect(mailer.sent[0]).toMatchObject({ to: "marcus@test.dev", subject: "Sam S. replied to your post" });
    expect(mailer.sent[0]!.text).toContain(`https://fs.test/discussions/${top.id}`);

    const again = await createPost(db, null, fellow, { body: "Agree with Sam", parentId: top.id }, later(3));
    expect(await notifyPostReply(db, mailer, again.id, { appUrl: "https://fs.test", now: later(3) })).toEqual({ sent: false, reason: "recently_notified" });

    await db.insert(schema.emailPreferences).values({ userId: "marcus", replies: false });
    const after = await createPost(db, null, fellow, { body: "One more thought", parentId: top.id }, later(60 * 7));
    expect(await notifyPostReply(db, mailer, after.id, { appUrl: "https://fs.test", now: later(60 * 7) })).toEqual({ sent: false, reason: "opted_out" });
  });
});
