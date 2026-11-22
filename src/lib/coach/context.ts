/**
 * What the coach knows about the member it's talking to: his profile, his
 * progress and his path. Rendered as a short block the coach sees each turn.
 */
import { and, count, eq, isNull } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { certificates, coachProfiles, user, watchProgress } from "@/lib/db/schema";
import { continueWatching, coursesInProgress } from "@/lib/courses/catalog";
import { getPath } from "./path";
import { COACH_STAGES, isCoachStage, type CoachStage } from "./policy";

export type FatherContext = {
  firstName: string;
  profile: { stage: CoachStage; children: string | null; goals: string | null } | null;
  inProgress: { title: string; percent: number; path: string }[];
  recent: { title: string; context: string; path: string }[];
  completedLessons: number;
  certificates: string[];
  path: { summary: string; steps: { title: string; path: string; done: boolean }[] } | null;
};

export async function getProfile(db: Database, userId: string) {
  const row = await db.query.coachProfiles.findFirst({ where: eq(coachProfiles.userId, userId) });
  return row && isCoachStage(row.stage) ? { stage: row.stage, children: row.children, goals: row.goals, updatedAt: row.updatedAt } : null;
}

export async function saveProfile(db: Database, userId: string, profile: { stage: CoachStage; children: string | null; goals: string | null }) {
  await db
    .insert(coachProfiles)
    .values({ userId, ...profile })
    .onConflictDoUpdate({ target: coachProfiles.userId, set: { ...profile, updatedAt: new Date() } });
}

export async function fatherContext(db: Database, userId: string): Promise<FatherContext> {
  const [person, profile, inProgress, recent, [completed], certs, path] = await Promise.all([
    db.query.user.findFirst({ where: eq(user.id, userId), columns: { name: true } }),
    getProfile(db, userId),
    coursesInProgress(db, userId),
    continueWatching(db, userId, 4),
    db.select({ n: count() }).from(watchProgress).where(and(eq(watchProgress.userId, userId), eq(watchProgress.completed, true))),
    db.select({ title: certificates.courseTitle }).from(certificates).where(and(eq(certificates.userId, userId), isNull(certificates.revokedAt))),
    getPath(db, userId),
  ]);
  return {
    firstName: person?.name.trim().split(/\s+/)[0] ?? "there",
    profile: profile ? { stage: profile.stage, children: profile.children, goals: profile.goals } : null,
    inProgress: inProgress.slice(0, 5).map((c) => ({ title: c.title, percent: c.percentComplete ?? 0, path: `/academy/${c.slug}` })),
    recent: recent.map((r) => ({ title: r.title, context: r.context, path: r.href })),
    completedLessons: completed?.n ?? 0,
    certificates: certs.map((c) => c.title),
    path: path ? { summary: path.summary, steps: path.steps.map((s) => ({ title: s.title, path: s.path, done: s.done })) } : null,
  };
}

/** The context block for the coach. Profile text is the member's own words, so it is marked as data. */
export function renderContext(c: FatherContext, today: Date = new Date()): string {
  const lines = [`Today is ${today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}.`, `His first name: ${c.firstName}`];
  if (c.profile) {
    lines.push(`Stage: ${COACH_STAGES[c.profile.stage]}`);
    if (c.profile.children) lines.push(`His children, in his words: ${c.profile.children}`);
    if (c.profile.goals) lines.push(`What he wants to work on, in his words: ${c.profile.goals}`);
  } else {
    lines.push("He hasn't filled in his profile yet. If it would help, ask about his children and what he wants to work on.");
  }
  lines.push(`Lessons completed: ${c.completedLessons}${c.certificates.length ? `; certificates: ${c.certificates.join(", ")}` : ""}`);
  if (c.inProgress.length) lines.push(`Courses in progress: ${c.inProgress.map((p) => `${p.title} (${p.percent}%, ${p.path})`).join("; ")}`);
  if (c.recent.length) lines.push(`Started recently: ${c.recent.map((r) => `${r.title} (${r.context}, ${r.path})`).join("; ")}`);
  if (c.path) {
    lines.push(`His learning path: ${c.path.summary}`);
    for (const s of c.path.steps) lines.push(`  - ${s.done ? "[done] " : ""}${s.title} (${s.path})`);
  }
  return `<member_context>\n${lines.join("\n")}\n</member_context>`;
}
