/** Numbers and previews for /admin/emails. */
import { desc, eq, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { emailSends, user } from "@/lib/db/schema";
import { SEQUENCE_IDS, SEQUENCES, sampleContext, type EmailContext, type SequenceId } from "./sequences";
import { renderEmail } from "./template";
import { emailToken } from "./tokens";

export type SequenceStats = {
  id: SequenceId;
  enrollments: { active: number; completed: number; exited: number };
  steps: { id: string; delayHours: number; sent: number; skipped: number; failed: number }[];
};

/** Enrollment counts, and sends per step since `since`. */
export async function sequenceStats(db: Database, since: Date): Promise<SequenceStats[]> {
  const [enrollments, sends] = await Promise.all([
    db.execute<{ sequence: string; status: string; n: number }>(sql`select sequence, status, count(*)::int as n from email_enrollments group by 1, 2`),
    db.execute<{ sequence: string; step: string; status: string; n: number }>(sql`
      select sequence, step, status, count(*)::int as n from email_sends
      where sequence is not null and created_at >= ${since.toISOString()}::timestamptz group by 1, 2, 3`),
  ]);
  const enrolled = (seq: string, status: string) => enrollments.find((r) => r.sequence === seq && r.status === status)?.n ?? 0;
  const sent = (seq: string, step: string, status: string) => sends.find((r) => r.sequence === seq && r.step === step && r.status === status)?.n ?? 0;
  return SEQUENCE_IDS.map((id) => ({
    id,
    enrollments: { active: enrolled(id, "active"), completed: enrolled(id, "completed"), exited: enrolled(id, "exited") },
    steps: SEQUENCES[id].steps.map((s) => ({
      id: s.id,
      delayHours: s.delayHours,
      sent: sent(id, s.id, "sent"),
      skipped: sent(id, s.id, "skipped"),
      failed: sent(id, s.id, "failed"),
    })),
  }));
}

export async function recentSends(db: Database, limit = 25) {
  return db
    .select({
      id: emailSends.id,
      email: user.email,
      category: emailSends.category,
      sequence: emailSends.sequence,
      step: emailSends.step,
      subject: emailSends.subject,
      status: emailSends.status,
      error: emailSends.error,
      createdAt: emailSends.createdAt,
    })
    .from(emailSends)
    .innerJoin(user, eq(emailSends.userId, user.id))
    .orderBy(desc(emailSends.createdAt))
    .limit(limit);
}

/** How many people turned each category off. */
export async function optOutCounts(db: Database) {
  const [row] = await db.execute<{ learning: number; announcements: number; replies: number }>(sql`
    select count(*) filter (where not learning)::int as learning,
           count(*) filter (where not announcements)::int as announcements,
           count(*) filter (where not replies)::int as replies
    from email_preferences`);
  return row ?? { learning: 0, announcements: 0, replies: 0 };
}

export type PreviewVariant = "new" | "progress";

/** Sample situations: someone just starting, and a member partway through. */
export function previewContext(sequence: SequenceId, variant: PreviewVariant): EmailContext {
  const member = sequence === "member_onboarding" || sequence === "reengagement";
  const ended = sequence === "winback" ? new Date("2026-09-15T00:00:00Z") : null;
  if (variant === "new") return sampleContext({ member, membershipEndedAt: ended, lastActiveAt: new Date("2026-09-20T00:00:00Z") });
  return sampleContext({
    member,
    membershipEndedAt: ended,
    lastActiveAt: new Date("2026-09-20T00:00:00Z"),
    continueItem: { title: "Showing up every day", href: "/academy/present-fathers/sample-2", context: "Present Fathers" },
    lessonsCompleted: 4,
    certificates: 1,
  });
}

/**
 * Render one step for preview, or null if it would be skipped for this sample.
 * Pass the recipient's id when actually sending, so the footer links work for them.
 */
export function previewEmail(sequence: SequenceId, stepId: string, variant: PreviewVariant, appUrl: string, to = "sam@example.com", userId = "preview") {
  const seq = SEQUENCES[sequence];
  const step = seq.steps.find((s) => s.id === stepId);
  if (!step) return null;
  const content = step.render(previewContext(sequence, variant));
  if (!content) return null;
  return renderEmail(content, { appUrl, to, category: seq.category, token: emailToken(userId), campaign: `${sequence}-${stepId}-preview`, postalAddress: process.env.EMAIL_POSTAL_ADDRESS });
}
