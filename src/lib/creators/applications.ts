/**
 * Becoming a Fellow (creator): a member of the public applies and an admin
 * approves or declines, or an admin grants access directly (founding Fellows).
 * Approval makes the account a creator; admins are never downgraded.
 */
import { and, asc, desc, eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { creatorApplications, user } from "@/lib/db/schema";
import type { Mailer } from "@/lib/email";
import { fellowDecisionEmail } from "./emails";

export class ApplicationError extends Error {
  constructor(
    readonly reason: "already_fellow" | "already_pending" | "not_found" | "already_decided" | "no_account",
    message: string,
  ) {
    super(message);
    this.name = "ApplicationError";
  }
}

export type Application = typeof creatorApplications.$inferSelect;

export async function applyToBeFellow(
  db: Database,
  userId: string,
  input: { statement: string; sampleUrl?: string | null },
): Promise<Application> {
  const [account] = await db.select({ role: user.role }).from(user).where(eq(user.id, userId));
  if (!account) throw new ApplicationError("not_found", "Account not found.");
  if (account.role !== "user") throw new ApplicationError("already_fellow", "You can already upload videos.");
  const [row] = await db
    .insert(creatorApplications)
    .values({ userId, statement: input.statement.trim(), sampleUrl: input.sampleUrl?.trim() || null })
    .onConflictDoNothing()
    .returning();
  if (!row) throw new ApplicationError("already_pending", "Your application is already with our team.");
  return row;
}

/** The person's most recent application, if any. */
export async function latestApplication(db: Database, userId: string): Promise<Application | null> {
  const [row] = await db
    .select()
    .from(creatorApplications)
    .where(eq(creatorApplications.userId, userId))
    .orderBy(desc(creatorApplications.createdAt))
    .limit(1);
  return row ?? null;
}

export async function pendingApplications(db: Database) {
  return db
    .select({
      id: creatorApplications.id,
      statement: creatorApplications.statement,
      sampleUrl: creatorApplications.sampleUrl,
      createdAt: creatorApplications.createdAt,
      userId: user.id,
      name: user.name,
      email: user.email,
    })
    .from(creatorApplications)
    .innerJoin(user, eq(creatorApplications.userId, user.id))
    .where(eq(creatorApplications.status, "pending"))
    .orderBy(asc(creatorApplications.createdAt));
}

/** Current Fellows (creators), for the admin page. */
export async function listFellows(db: Database) {
  return db.select({ id: user.id, name: user.name, email: user.email }).from(user).where(eq(user.role, "creator")).orderBy(asc(user.name));
}

type Notify = { mailer: Mailer | null; studioUrl: string };

async function notify(notifyWith: Notify, input: { name: string; email: string; decision: "approved" | "rejected"; notes: string | null; key: string }) {
  if (!notifyWith.mailer) return false;
  try {
    await notifyWith.mailer.send({
      ...fellowDecisionEmail({ ...input, studioUrl: notifyWith.studioUrl }),
      idempotencyKey: input.key,
    });
    return true;
  } catch (error) {
    // The decision stands; a failed notification is logged, not rolled back.
    console.error(`Fellow decision email to ${input.email} failed`, error);
    return false;
  }
}

/** Approve or decline a pending application. Only one admin's decision can win. */
export async function decideApplication(
  db: Database,
  input: { applicationId: string; adminId: string; decision: "approved" | "rejected"; notes?: string | null },
  notifyWith: Notify,
  now: Date = new Date(),
): Promise<{ emailed: boolean }> {
  const notes = input.notes?.trim() || null;
  const applicant = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(creatorApplications)
      .set({ status: input.decision, reviewedById: input.adminId, reviewedAt: now, decisionNotes: notes })
      .where(and(eq(creatorApplications.id, input.applicationId), eq(creatorApplications.status, "pending")))
      .returning({ userId: creatorApplications.userId });
    if (!row) {
      const [exists] = await tx.select({ id: creatorApplications.id }).from(creatorApplications).where(eq(creatorApplications.id, input.applicationId));
      throw exists
        ? new ApplicationError("already_decided", "This application has already been decided.")
        : new ApplicationError("not_found", "Application not found.");
    }
    if (input.decision === "approved") {
      await tx.update(user).set({ role: "creator" }).where(and(eq(user.id, row.userId), eq(user.role, "user")));
    }
    const [person] = await tx.select({ name: user.name, email: user.email }).from(user).where(eq(user.id, row.userId));
    return person!;
  });
  const emailed = await notify(notifyWith, { ...applicant, decision: input.decision, notes, key: `fellow-application-${input.applicationId}` });
  return { emailed };
}

/**
 * Make an existing account a Fellow without an application (invitations).
 * Any open application is approved along with it.
 */
export async function grantFellow(
  db: Database,
  input: { email: string; adminId: string },
  notifyWith: Notify,
  now: Date = new Date(),
): Promise<{ name: string; alreadyFellow: boolean; emailed: boolean }> {
  const email = input.email.trim().toLowerCase();
  const result = await db.transaction(async (tx) => {
    const [person] = await tx.select({ id: user.id, name: user.name, email: user.email, role: user.role }).from(user).where(eq(user.email, email));
    if (!person) throw new ApplicationError("no_account", `No account uses ${email}. Ask them to sign up first, then grant access.`);
    if (person.role !== "user") return { person, alreadyFellow: true };
    await tx.update(user).set({ role: "creator" }).where(eq(user.id, person.id));
    await tx
      .update(creatorApplications)
      .set({ status: "approved", reviewedById: input.adminId, reviewedAt: now })
      .where(and(eq(creatorApplications.userId, person.id), eq(creatorApplications.status, "pending")));
    return { person, alreadyFellow: false };
  });
  const emailed = result.alreadyFellow
    ? false
    : await notify(notifyWith, { name: result.person.name, email: result.person.email, decision: "approved", notes: null, key: `fellow-grant-${result.person.id}` });
  return { name: result.person.name, alreadyFellow: result.alreadyFellow, emailed };
}

/** Take upload access away. Their published videos stay up; admins are unaffected. */
export async function revokeFellow(db: Database, userId: string): Promise<void> {
  const [row] = await db.update(user).set({ role: "user" }).where(and(eq(user.id, userId), eq(user.role, "creator"))).returning({ id: user.id });
  if (!row) throw new ApplicationError("not_found", "That person isn't a Fellow.");
}
