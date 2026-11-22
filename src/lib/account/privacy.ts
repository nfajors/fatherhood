/**
 * A member's own data: download it all (data portability, UK and EU GDPR and
 * similar laws), or delete the account (the right to erasure).
 *
 * Deleting cancels any Stripe subscriptions first, then removes the account; the
 * database cascades remove what belongs to it (progress, ratings, comments, posts,
 * coach conversations, memberships of organizations and groups). Payment records
 * stay in Stripe and in our revenue ledger without the person's name, as accounting
 * law requires. Fellows with videos or earnings are asked to contact us, so their
 * payouts are settled before anything is removed.
 */
import { and, eq, inArray, or } from "drizzle-orm";
import type { Database } from "@/lib/db";
import {
  certificates,
  coachConversations,
  coachMessages,
  coachProfiles,
  comments,
  creatorApplications,
  creatorPayouts,
  discussionGroupMembers,
  discussionGroups,
  emailPreferences,
  follows,
  gifts,
  learningPaths,
  organizationMembers,
  organizations,
  poolShares,
  posts,
  quizAttempts,
  ratings,
  subscriptions,
  user,
  videos,
  watchProgress,
} from "@/lib/db/schema";

export class AccountError extends Error {
  constructor(
    readonly reason: "not_found" | "fellow_with_content" | "confirm",
    message: string,
  ) {
    super(message);
  }
}

/** Everything we hold that the person gave us or did, as one JSON-ready object. */
export async function exportAccount(db: Database, userId: string) {
  const person = await db.query.user.findFirst({ where: eq(user.id, userId), columns: { id: true, name: true, email: true, role: true, createdAt: true } });
  if (!person) throw new AccountError("not_found", "Account not found.");
  const [memberships, progress, myRatings, myComments, myPosts, myFollows, groupRows, attempts, certs, coachProfile, conversations, messages, path, orgRows, prefs, giftRows, applications, myVideos] =
    await Promise.all([
      db.select({ plan: subscriptions.plan, status: subscriptions.status, currency: subscriptions.currency, currentPeriodEnd: subscriptions.currentPeriodEnd, startedAt: subscriptions.createdAt }).from(subscriptions).where(eq(subscriptions.userId, userId)),
      db.select({ videoId: watchProgress.videoId, title: videos.title, positionSeconds: watchProgress.positionSeconds, completed: watchProgress.completed, updatedAt: watchProgress.updatedAt }).from(watchProgress).innerJoin(videos, eq(videos.id, watchProgress.videoId)).where(eq(watchProgress.userId, userId)),
      db.select({ video: videos.title, stars: ratings.stars, review: ratings.review, createdAt: ratings.createdAt }).from(ratings).innerJoin(videos, eq(videos.id, ratings.videoId)).where(eq(ratings.userId, userId)),
      db.select({ video: videos.title, body: comments.body, status: comments.status, createdAt: comments.createdAt }).from(comments).innerJoin(videos, eq(videos.id, comments.videoId)).where(eq(comments.userId, userId)),
      db.select({ id: posts.id, body: posts.body, status: posts.status, isReply: posts.parentId, createdAt: posts.createdAt }).from(posts).where(eq(posts.authorId, userId)),
      db.select({ followeeId: follows.followeeId, since: follows.createdAt }).from(follows).where(eq(follows.followerId, userId)),
      db.select({ group: discussionGroups.name, role: discussionGroupMembers.role, joinedAt: discussionGroupMembers.joinedAt }).from(discussionGroupMembers).innerJoin(discussionGroups, eq(discussionGroups.id, discussionGroupMembers.groupId)).where(eq(discussionGroupMembers.userId, userId)),
      db.select({ quizId: quizAttempts.quizId, scorePercent: quizAttempts.scorePercent, passed: quizAttempts.passed, createdAt: quizAttempts.createdAt }).from(quizAttempts).where(eq(quizAttempts.userId, userId)),
      db.select({ course: certificates.courseTitle, code: certificates.code, issuedAt: certificates.issuedAt, revokedAt: certificates.revokedAt }).from(certificates).where(eq(certificates.userId, userId)),
      db.select({ stage: coachProfiles.stage, children: coachProfiles.children, goals: coachProfiles.goals }).from(coachProfiles).where(eq(coachProfiles.userId, userId)),
      db.select({ id: coachConversations.id, title: coachConversations.title, createdAt: coachConversations.createdAt }).from(coachConversations).where(eq(coachConversations.userId, userId)),
      db.select({ conversationId: coachMessages.conversationId, role: coachMessages.role, content: coachMessages.content, createdAt: coachMessages.createdAt }).from(coachMessages).where(eq(coachMessages.userId, userId)).orderBy(coachMessages.createdAt),
      db.select({ summary: learningPaths.summary, steps: learningPaths.steps, updatedAt: learningPaths.updatedAt }).from(learningPaths).where(eq(learningPaths.userId, userId)),
      db.select({ organization: organizations.name, isManager: organizationMembers.isManager, sharesProgress: organizationMembers.shareProgress, status: organizationMembers.status, joinedAt: organizationMembers.joinedAt }).from(organizationMembers).innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId)).where(eq(organizationMembers.userId, userId)),
      db.select().from(emailPreferences).where(eq(emailPreferences.userId, userId)),
      db.select({ plan: gifts.plan, amountCents: gifts.amountCents, currency: gifts.currency, status: gifts.status, recipientName: gifts.recipientName, purchasedByYou: eq(gifts.purchaserUserId, userId), createdAt: gifts.createdAt }).from(gifts).where(or(eq(gifts.purchaserUserId, userId), eq(gifts.redeemedByUserId, userId))),
      db.select({ statement: creatorApplications.statement, status: creatorApplications.status, createdAt: creatorApplications.createdAt }).from(creatorApplications).where(eq(creatorApplications.userId, userId)),
      db.select({ id: videos.id, title: videos.title, description: videos.description, status: videos.status, createdAt: videos.createdAt }).from(videos).where(eq(videos.creatorId, userId)),
    ]);
  const prefsRow = prefs[0];
  return {
    exportedAt: new Date().toISOString(),
    account: person,
    memberships,
    watchProgress: progress,
    ratings: myRatings,
    comments: myComments,
    discussions: { posts: myPosts.map(({ isReply, ...p }) => ({ ...p, isReply: Boolean(isReply) })), following: myFollows, groups: groupRows },
    quizAttempts: attempts,
    certificates: certs,
    coach: { profile: coachProfile[0] ?? null, conversations: conversations.map((c) => ({ ...c, messages: messages.filter((m) => m.conversationId === c.id).map((m) => ({ role: m.role, content: m.content, createdAt: m.createdAt })) })), learningPath: path[0] ?? null },
    organizations: orgRows,
    emailPreferences: prefsRow ? { learning: prefsRow.learning, announcements: prefsRow.announcements, replies: prefsRow.replies } : null,
    gifts: giftRows,
    fellowApplications: applications,
    videos: myVideos,
  };
}

/** Cancels a Stripe subscription at once (production: Stripe; tests: a fake). */
export interface SubscriptionCanceller {
  cancel(stripeSubscriptionId: string): Promise<void>;
}

/** Delete the account. `confirmation` must be the word DELETE, typed by the person. */
export async function deleteAccount(db: Database, canceller: SubscriptionCanceller, input: { userId: string; confirmation: string }) {
  if (input.confirmation.trim().toUpperCase() !== "DELETE") throw new AccountError("confirm", 'Type DELETE to confirm.');
  const person = await db.query.user.findFirst({ where: eq(user.id, input.userId), columns: { id: true } });
  if (!person) throw new AccountError("not_found", "Account not found.");

  const [video, payout, share] = await Promise.all([
    db.query.videos.findFirst({ where: eq(videos.creatorId, input.userId), columns: { id: true } }),
    db.query.creatorPayouts.findFirst({ where: eq(creatorPayouts.creatorId, input.userId), columns: { id: true } }),
    db.query.poolShares.findFirst({ where: eq(poolShares.creatorId, input.userId), columns: { id: true } }),
  ]);
  if (video || payout || share) {
    throw new AccountError("fellow_with_content", "Your account has videos or creator earnings. Email us and we'll settle any payouts and delete it for you.");
  }

  // Stop billing first: if this fails, nothing has been deleted and the person can try again.
  const billing = await db
    .select({ id: subscriptions.stripeSubscriptionId })
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, input.userId), inArray(subscriptions.status, ["active", "trialing", "past_due", "unpaid", "paused", "incomplete"])));
  for (const s of billing) if (s.id) await canceller.cancel(s.id);

  await db.delete(user).where(eq(user.id, input.userId));
}
