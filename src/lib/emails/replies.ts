/**
 * "Someone replied to your comment" emails. The person who started a
 * conversation hears about replies to it, at most once per conversation in a
 * few hours (a lively thread shouldn't fill their inbox), and never about
 * their own replies.
 */
import { aliasedTable, and, eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { comments, courseModules, courses, emailSends, lessons, user, videos } from "@/lib/db/schema";
import type { Mailer } from "@/lib/email";
import { reviewerName } from "@/lib/ratings/service";
import { EMAIL_POLICY as P } from "./policy";
import { getPreferences } from "./preferences";
import { renderEmail } from "./template";
import { emailToken } from "./tokens";

const SNIPPET = 400;

/** Where the conversation lives: the Community video page, or the lesson in its published course. */
async function videoHref(db: Database, video: { id: string; type: string }): Promise<string | null> {
  if (video.type === "community") return `/community/${video.id}#comments`;
  const [lesson] = await db
    .select({ lessonId: lessons.id, slug: courses.slug })
    .from(lessons)
    .innerJoin(courseModules, eq(lessons.moduleId, courseModules.id))
    .innerJoin(courses, eq(courseModules.courseId, courses.id))
    .where(and(eq(lessons.videoId, video.id), eq(courses.published, true)))
    .limit(1);
  return lesson ? `/academy/${lesson.slug}/${lesson.lessonId}#comments` : null;
}

export type ReplyNotice = { sent: boolean; reason?: "not_a_reply" | "own_thread" | "not_visible" | "opted_out" | "recently_notified" | "no_page" };

export async function notifyReply(
  db: Database,
  mailer: Mailer,
  replyId: string,
  options: { appUrl: string; postalAddress?: string | null; now?: Date },
): Promise<ReplyNotice> {
  const now = options.now ?? new Date();
  const root = aliasedTable(comments, "root");
  const author = aliasedTable(user, "root_author");
  const [found] = await db
    .select({
      reply: comments,
      replierName: user.name,
      rootId: root.id,
      rootStatus: root.status,
      rootBody: root.body,
      recipientId: author.id,
      recipientEmail: author.email,
      recipientName: author.name,
      video: { id: videos.id, type: videos.type, title: videos.title },
    })
    .from(comments)
    .innerJoin(user, eq(comments.userId, user.id))
    .innerJoin(root, eq(comments.parentId, root.id))
    .innerJoin(author, eq(root.userId, author.id))
    .innerJoin(videos, eq(comments.videoId, videos.id))
    .where(eq(comments.id, replyId));
  if (!found) return { sent: false, reason: "not_a_reply" };
  if (found.recipientId === found.reply.userId) return { sent: false, reason: "own_thread" };
  if (found.reply.status !== "visible" || found.rootStatus !== "visible") return { sent: false, reason: "not_visible" };
  if (!(await getPreferences(db, found.recipientId)).replies) return { sent: false, reason: "opted_out" };
  const href = await videoHref(db, found.video);
  if (!href) return { sent: false, reason: "no_page" };

  const windowStart = Math.floor(now.getTime() / (P.replyWindowHours * 3_600_000));
  const key = `reply:${found.rootId}:${found.recipientId}:${windowStart}`;
  const replier = reviewerName(found.replierName);
  const subject = `${replier} replied to your comment on "${found.video.title}"`;
  // Claim the window first: if the key exists, this conversation already produced an email recently.
  const [claimed] = await db
    .insert(emailSends)
    .values({ userId: found.recipientId, key, category: "replies", subject, status: "sent", createdAt: now })
    .onConflictDoNothing({ target: emailSends.key })
    .returning({ id: emailSends.id });
  if (!claimed) return { sent: false, reason: "recently_notified" };

  const clip = (s: string) => (s.length > SNIPPET ? `${s.slice(0, SNIPPET).trimEnd()}…` : s);
  try {
    await mailer.send(
      renderEmail(
        {
          subject,
          preheader: clip(found.reply.body).slice(0, 120),
          heading: `${replier} replied to you`,
          blocks: [
            { kind: "small", text: `On "${found.video.title}", you wrote:` },
            { kind: "quote", text: clip(found.rootBody) },
            { kind: "small", text: `${replier} replied:` },
            { kind: "quote", text: clip(found.reply.body) },
            { kind: "button", label: "See the conversation", href },
          ],
        },
        {
          appUrl: options.appUrl,
          to: found.recipientEmail,
          category: "replies",
          token: emailToken(found.recipientId),
          campaign: "comment-reply",
          postalAddress: options.postalAddress,
          idempotencyKey: key,
        },
      ),
    );
    return { sent: true };
  } catch (error) {
    await db
      .update(emailSends)
      .set({ status: "failed", error: error instanceof Error ? error.message : String(error) })
      .where(eq(emailSends.id, claimed.id));
    throw error;
  }
}
