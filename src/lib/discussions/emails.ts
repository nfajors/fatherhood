/**
 * "Someone replied to your post" emails, the same way as comment replies: the person
 * who started a thread hears about replies, at most once per thread in a few hours,
 * never about his own, only for visible posts, and only with "Replies" on.
 */
import { aliasedTable, eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { emailSends, posts, user } from "@/lib/db/schema";
import type { Mailer } from "@/lib/email";
import { EMAIL_POLICY } from "@/lib/emails/policy";
import { getPreferences } from "@/lib/emails/preferences";
import { renderEmail } from "@/lib/emails/template";
import { emailToken } from "@/lib/emails/tokens";
import { reviewerName } from "@/lib/ratings/service";

const SNIPPET = 400;
const clip = (s: string) => (s.length > SNIPPET ? `${s.slice(0, SNIPPET).trimEnd()}…` : s);

export async function notifyPostReply(
  db: Database,
  mailer: Mailer,
  replyId: string,
  options: { appUrl: string; postalAddress?: string | null; now?: Date },
): Promise<{ sent: boolean; reason?: string }> {
  const now = options.now ?? new Date();
  const root = aliasedTable(posts, "root");
  const author = aliasedTable(user, "root_author");
  const [found] = await db
    .select({ reply: posts, replierName: user.name, rootId: root.id, rootStatus: root.status, rootBody: root.body, recipientId: author.id, recipientEmail: author.email })
    .from(posts)
    .innerJoin(user, eq(user.id, posts.authorId))
    .innerJoin(root, eq(root.id, posts.parentId))
    .innerJoin(author, eq(author.id, root.authorId))
    .where(eq(posts.id, replyId));
  if (!found) return { sent: false, reason: "not_a_reply" };
  if (found.recipientId === found.reply.authorId) return { sent: false, reason: "own_thread" };
  if (found.reply.status !== "visible" || found.rootStatus !== "visible") return { sent: false, reason: "not_visible" };
  if (!(await getPreferences(db, found.recipientId)).replies) return { sent: false, reason: "opted_out" };

  const windowStart = Math.floor(now.getTime() / (EMAIL_POLICY.replyWindowHours * 3_600_000));
  const key = `post-reply:${found.rootId}:${found.recipientId}:${windowStart}`;
  const replier = reviewerName(found.replierName);
  const subject = `${replier} replied to your post`;
  const [claimed] = await db
    .insert(emailSends)
    .values({ userId: found.recipientId, key, category: "replies", subject, status: "sent", createdAt: now })
    .onConflictDoNothing({ target: emailSends.key })
    .returning({ id: emailSends.id });
  if (!claimed) return { sent: false, reason: "recently_notified" };
  try {
    await mailer.send(
      renderEmail(
        {
          subject,
          preheader: clip(found.reply.body).slice(0, 120),
          heading: `${replier} replied to you`,
          blocks: [
            { kind: "small", text: "You wrote:" },
            { kind: "quote", text: clip(found.rootBody) },
            { kind: "small", text: `${replier} replied:` },
            { kind: "quote", text: clip(found.reply.body) },
            { kind: "button", label: "See the conversation", href: `/discussions/${found.rootId}` },
          ],
        },
        { appUrl: options.appUrl, to: found.recipientEmail, category: "replies", token: emailToken(found.recipientId), campaign: "post-reply", postalAddress: options.postalAddress, idempotencyKey: key },
      ),
    );
    return { sent: true };
  } catch (error) {
    await db.update(emailSends).set({ status: "failed", error: error instanceof Error ? error.message : String(error) }).where(eq(emailSends.id, claimed.id));
    throw error;
  }
}
