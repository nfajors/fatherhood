import { eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { emailPreferences, type EmailCategory } from "@/lib/db/schema";

export type EmailPreferences = Record<EmailCategory, boolean>;

const DEFAULTS: EmailPreferences = { learning: true, announcements: true, replies: true };

export async function getPreferences(db: Database, userId: string): Promise<EmailPreferences> {
  const [row] = await db.select().from(emailPreferences).where(eq(emailPreferences.userId, userId));
  return row ? { learning: row.learning, announcements: row.announcements, replies: row.replies } : { ...DEFAULTS };
}

export async function updatePreferences(db: Database, userId: string, changes: Partial<EmailPreferences>, now: Date = new Date()): Promise<EmailPreferences> {
  const values = { ...(await getPreferences(db, userId)), ...changes };
  await db
    .insert(emailPreferences)
    .values({ userId, ...values, updatedAt: now })
    .onConflictDoUpdate({ target: emailPreferences.userId, set: { ...values, updatedAt: now } });
  return values;
}

/** Turn off one category, or everything optional. */
export async function unsubscribe(db: Database, userId: string, category: EmailCategory | "all", now: Date = new Date()) {
  const off: Partial<EmailPreferences> = category === "all" ? { learning: false, announcements: false, replies: false } : { [category]: false };
  return updatePreferences(db, userId, off, now);
}
