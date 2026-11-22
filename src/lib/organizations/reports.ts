/**
 * What an organization's managers see. Totals cover the group; names and progress
 * appear only for fathers who chose to share them. Coach conversations are never
 * included. When only a few fathers keep their progress private, totals leave them
 * out, so the sharers' figures can't be subtracted from the totals to reveal them.
 */
import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { certificates, lessons, organizationMembers, user, videos, watchProgress, watchSessions } from "@/lib/db/schema";
import { accessWindow, contractsFor, getOrganization } from "./service";
import { ORG_POLICY } from "./policy";

export type PersonProgress = { lessonsCompleted: number; certificates: string[]; watchSeconds: number; lastActiveAt: Date | null };

/** Pure: whose progress the totals may include. */
export function totalsCoverage(sharing: number, private_: number): "everyone" | "sharing_only" {
  return private_ === 0 || private_ >= ORG_POLICY.privacyGroupSize ? "everyone" : "sharing_only";
}

async function progressFor(db: Database, people: { userId: string; joinedAt: Date }[], now: Date) {
  const ids = people.map((p) => p.userId);
  const out = new Map<string, PersonProgress>(ids.map((id) => [id, { lessonsCompleted: 0, certificates: [], watchSeconds: 0, lastActiveAt: null }]));
  if (ids.length === 0) return { byUser: out, activeLast30: 0 };
  const since30 = new Date(now.getTime() - 30 * 24 * 3_600_000);
  const [completed, certs, sessions] = await Promise.all([
    db
      .select({ userId: watchProgress.userId, n: sql<number>`count(*)::int` })
      .from(watchProgress)
      .innerJoin(lessons, eq(lessons.videoId, watchProgress.videoId))
      .innerJoin(videos, eq(videos.id, watchProgress.videoId))
      .where(and(inArray(watchProgress.userId, ids), eq(watchProgress.completed, true), eq(videos.type, "professional")))
      .groupBy(watchProgress.userId),
    db
      .select({ userId: certificates.userId, title: certificates.courseTitle })
      .from(certificates)
      .where(and(inArray(certificates.userId, ids), isNull(certificates.revokedAt))),
    db
      .select({
        userId: watchSessions.userId,
        // Watching since he joined the organization.
        seconds: sql<number>`coalesce(sum(${watchSessions.secondsWatched}) filter (where ${watchSessions.startedAt} >= m.joined_at), 0)::int`,
        last: sql<Date | null>`max(${watchSessions.lastHeartbeatAt})`,
      })
      .from(watchSessions)
      .innerJoin(
        sql`(values ${sql.join(
          people.map((p) => sql`(${p.userId}, ${p.joinedAt.toISOString()}::timestamptz)`),
          sql`, `,
        )}) as m(user_id, joined_at)`,
        sql`m.user_id = ${watchSessions.userId}`,
      )
      .where(inArray(watchSessions.userId, ids))
      .groupBy(watchSessions.userId),
  ]);
  for (const c of completed) out.get(c.userId)!.lessonsCompleted = c.n;
  for (const c of certs) out.get(c.userId)!.certificates.push(c.title);
  let activeLast30 = 0;
  for (const s of sessions) {
    const p = out.get(s.userId!)!;
    p.watchSeconds = s.seconds;
    p.lastActiveAt = s.last ? new Date(s.last) : null;
    if (p.lastActiveAt && p.lastActiveAt >= since30) activeLast30++;
  }
  return { byUser: out, activeLast30 };
}

export async function organizationReport(db: Database, orgId: string, now: Date = new Date()) {
  const org = await getOrganization(db, { id: orgId });
  if (!org) return null;
  const [contracts, fathers, pending] = await Promise.all([
    contractsFor(db, orgId),
    db
      .select({ id: organizationMembers.id, userId: organizationMembers.userId, email: organizationMembers.email, name: user.name, joinedAt: organizationMembers.joinedAt, share: organizationMembers.shareProgress })
      .from(organizationMembers)
      .innerJoin(user, eq(user.id, organizationMembers.userId))
      .where(and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.isManager, false), eq(organizationMembers.status, "active"))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(organizationMembers)
      .where(and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.isManager, false), eq(organizationMembers.status, "invited"), gte(organizationMembers.inviteExpiresAt, now))),
  ]);
  const window = accessWindow(contracts, now);
  const sharing = fathers.filter((f) => f.share);
  const coverage = totalsCoverage(sharing.length, fathers.length - sharing.length);
  const included = coverage === "everyone" ? fathers : sharing;
  const { byUser, activeLast30 } = await progressFor(
    db,
    included.map((f) => ({ userId: f.userId!, joinedAt: f.joinedAt ?? now })),
    now,
  );
  const all = [...byUser.values()];
  return {
    organization: org,
    window,
    contracts,
    seats: { total: window.seats, used: fathers.length, invited: pending[0]?.n ?? 0 },
    totals: {
      coverage,
      fathers: included.length,
      activeLast30,
      lessonsCompleted: all.reduce((t, p) => t + p.lessonsCompleted, 0),
      certificates: all.reduce((t, p) => t + p.certificates.length, 0),
      watchSeconds: all.reduce((t, p) => t + p.watchSeconds, 0),
    },
    sharingCount: sharing.length,
    privateCount: fathers.length - sharing.length,
    people: fathers
      .map((f) => ({ id: f.id, name: f.name, email: f.email, joinedAt: f.joinedAt, shares: f.share, progress: f.share ? (byUser.get(f.userId!) ?? null) : null }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** CSV of the fathers who share their progress, for the program's records. */
export function progressCsv(report: NonNullable<Awaited<ReturnType<typeof organizationReport>>>): string {
  const cell = (v: string | number) => {
    const s = String(v);
    // Quote, and defuse spreadsheet formulas in names.
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) || safe !== s ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const rows = [["Name", "Email", "Joined", "Lessons completed", "Hours watched since joining", "Certificates", "Last active"]];
  for (const p of report.people) {
    if (!p.progress) continue;
    rows.push([
      p.name,
      p.email,
      p.joinedAt ? p.joinedAt.toISOString().slice(0, 10) : "",
      String(p.progress.lessonsCompleted),
      (p.progress.watchSeconds / 3600).toFixed(1),
      p.progress.certificates.join("; "),
      p.progress.lastActiveAt ? p.progress.lastActiveAt.toISOString().slice(0, 10) : "",
    ]);
  }
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
