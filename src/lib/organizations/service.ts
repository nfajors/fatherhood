/**
 * Organization licenses: organizations, contracts (seats for a term, at a price set
 * per contract and invoiced through Stripe), invitations and join codes, and the
 * access each seat gives.
 *
 * A seat's access is an ordinary `subscriptions` row with plan "organization", kept
 * in step with the organization's contracts by syncOrgAccess. So playback, the
 * coach, email sequences and analytics treat these fathers as members without
 * knowing about organizations.
 */
import { and, asc, desc, eq, gt, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import {
  organizationContracts,
  organizationMembers,
  organizations,
  revenueLedger,
  subscriptions,
  user,
  type ContractStatus,
  type OrganizationKind,
} from "@/lib/db/schema";
import type { Mailer } from "@/lib/email";
import { slugify } from "@/lib/slug";
import { hashInviteToken, newInviteToken, newJoinCode, normalizeJoinCode } from "./codes";
import { inviteEmail } from "./emails";
import { ORG_POLICY } from "./policy";

export class OrgError extends Error {
  constructor(
    readonly reason: "not_found" | "invalid" | "no_seats" | "not_active" | "expired" | "used" | "not_allowed" | "already_member",
    message: string,
  ) {
    super(message);
  }
}

/** Stripe invoicing, as organization contracts need it (Stripe in production, a fake in tests). */
export interface OrgBilling {
  ensureCustomer(org: { id: string; name: string; contactEmail: string; contactName: string | null; stripeCustomerId: string | null }): Promise<string>;
  sendInvoice(input: { customerId: string; contractId: string; amountCents: number; description: string; daysUntilDue: number }): Promise<{ invoiceId: string; invoiceUrl: string | null }>;
  voidInvoice(invoiceId: string): Promise<void>;
}

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Db = Database | Tx;

const DAY = 24 * 3_600_000;
const fmtDay = (d: Date) => d.toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" });

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

export type Organization = typeof organizations.$inferSelect;

export async function createOrganization(
  db: Database,
  input: { name: string; kind: OrganizationKind; contactName: string | null; contactEmail: string },
): Promise<Organization> {
  const name = input.name.trim();
  if (name.length < 2) throw new OrgError("invalid", "Give the organization a name.");
  const base = slugify(name) || "organization";
  for (let n = 1; n < 50; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const [row] = await db
      .insert(organizations)
      .values({ name, slug, kind: input.kind, contactName: input.contactName?.trim() || null, contactEmail: input.contactEmail.trim().toLowerCase() })
      .onConflictDoNothing({ target: organizations.slug })
      .returning();
    if (row) return row;
  }
  throw new OrgError("invalid", "Couldn't choose an address for this organization. Try a different name.");
}

export async function updateOrganization(db: Database, id: string, input: { name: string; kind: OrganizationKind; contactName: string | null; contactEmail: string }) {
  const [row] = await db
    .update(organizations)
    .set({ name: input.name.trim(), kind: input.kind, contactName: input.contactName?.trim() || null, contactEmail: input.contactEmail.trim().toLowerCase() })
    .where(eq(organizations.id, id))
    .returning();
  if (!row) throw new OrgError("not_found", "Organization not found.");
  return row;
}

export async function getOrganization(db: Db, by: { id: string } | { slug: string }) {
  return (await db.query.organizations.findFirst({ where: "id" in by ? eq(organizations.id, by.id) : eq(organizations.slug, by.slug) })) ?? null;
}

/** Turn the join code on (creating one the first time, or a fresh one with `rotate`) or off. */
export async function setJoinCode(db: Database, orgId: string, input: { enabled: boolean; rotate?: boolean }) {
  const org = await getOrganization(db, { id: orgId });
  if (!org) throw new OrgError("not_found", "Organization not found.");
  const joinCode = !org.joinCode || input.rotate ? newJoinCode() : org.joinCode;
  const [row] = await db.update(organizations).set({ joinCode, joinCodeEnabled: input.enabled }).where(eq(organizations.id, orgId)).returning();
  return row!;
}

// ---------------------------------------------------------------------------
// Contracts and access
// ---------------------------------------------------------------------------

export type Contract = typeof organizationContracts.$inferSelect;
const GRANTS: ContractStatus[] = ["invoiced", "paid"];

export type AccessWindow = {
  /** Access now, and until when (following back-to-back contracts). */
  activeUntil: Date | null;
  /** Seats now: the sum of contracts in force; or, before the first starts, the next contract's. */
  seats: number;
  /** When access starts, if it hasn't yet. */
  startsAt: Date | null;
};

/** Pure: what an organization's contracts give at `now`. Invoiced contracts count while awaiting payment. */
export function accessWindow(contracts: Pick<Contract, "status" | "startsAt" | "endsAt" | "seats">[], now: Date): AccessWindow {
  const granting = contracts.filter((c) => GRANTS.includes(c.status)).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const current = granting.filter((c) => c.startsAt <= now && c.endsAt > now);
  if (current.length) {
    let end = new Date(Math.max(...current.map((c) => c.endsAt.getTime())));
    // Follow renewals that start by the time the current term ends.
    for (const c of granting) if (c.startsAt <= end && c.endsAt > end) end = c.endsAt;
    return { activeUntil: end, seats: current.reduce((t, c) => t + c.seats, 0), startsAt: null };
  }
  const next = granting.find((c) => c.startsAt > now);
  return { activeUntil: null, seats: next?.seats ?? 0, startsAt: next?.startsAt ?? null };
}

export async function contractsFor(db: Db, orgId: string) {
  return db.select().from(organizationContracts).where(eq(organizationContracts.organizationId, orgId)).orderBy(desc(organizationContracts.startsAt));
}

export async function createContract(
  db: Database,
  input: { orgId: string; seats: number; pricePerSeatCents: number; startsAt: Date; endsAt: Date; daysUntilDue?: number; notes?: string | null; createdById: string },
): Promise<Contract> {
  if (!Number.isInteger(input.seats) || input.seats < 1) throw new OrgError("invalid", "A contract needs at least one seat.");
  if (!Number.isInteger(input.pricePerSeatCents) || input.pricePerSeatCents < 0) throw new OrgError("invalid", "Enter the price per seat.");
  if (input.endsAt <= input.startsAt) throw new OrgError("invalid", "The end date must be after the start date.");
  if (!(await getOrganization(db, { id: input.orgId }))) throw new OrgError("not_found", "Organization not found.");
  const [row] = await db
    .insert(organizationContracts)
    .values({
      organizationId: input.orgId,
      seats: input.seats,
      pricePerSeatCents: input.pricePerSeatCents,
      amountCents: input.seats * input.pricePerSeatCents,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      daysUntilDue: input.daysUntilDue ?? ORG_POLICY.defaultDaysUntilDue,
      notes: input.notes?.trim() || null,
      createdById: input.createdById,
    })
    .returning();
  return row!;
}

async function loadContract(db: Db, contractId: string) {
  const [row] = await db
    .select({ contract: organizationContracts, org: organizations })
    .from(organizationContracts)
    .innerJoin(organizations, eq(organizations.id, organizationContracts.organizationId))
    .where(eq(organizationContracts.id, contractId));
  if (!row) throw new OrgError("not_found", "Contract not found.");
  return row;
}

export const contractDescription = (c: Pick<Contract, "seats" | "startsAt" | "endsAt">) =>
  `Fatherhood.School licenses: ${c.seats} ${c.seats === 1 ? "seat" : "seats"}, ${fmtDay(c.startsAt)} to ${fmtDay(new Date(c.endsAt.getTime() - 1))}`;

/** Send a draft contract's invoice through Stripe. Access begins on the start date, while the invoice awaits payment. */
export async function sendContractInvoice(db: Database, billing: OrgBilling, contractId: string, now: Date = new Date()) {
  const { contract, org } = await loadContract(db, contractId);
  if (contract.status !== "draft") throw new OrgError("not_allowed", "This contract has already been invoiced.");
  if (contract.amountCents === 0) throw new OrgError("invalid", "A free contract has nothing to invoice: record it as paid instead.");
  const customerId = await billing.ensureCustomer(org);
  if (customerId !== org.stripeCustomerId) await db.update(organizations).set({ stripeCustomerId: customerId }).where(eq(organizations.id, org.id));
  const invoice = await billing.sendInvoice({
    customerId,
    contractId,
    amountCents: contract.amountCents,
    description: contractDescription(contract),
    daysUntilDue: contract.daysUntilDue,
  });
  await db
    .update(organizationContracts)
    .set({ status: "invoiced", stripeInvoiceId: invoice.invoiceId, invoiceUrl: invoice.invoiceUrl, invoicedAt: now })
    .where(and(eq(organizationContracts.id, contractId), eq(organizationContracts.status, "draft")));
  await syncOrgAccess(db, org.id, now);
}

async function addRevenue(db: Db, input: { stripeObjectId: string; amountCents: number; occurredAt: Date }) {
  if (input.amountCents <= 0) return;
  await db.insert(revenueLedger).values({ kind: "organization", ...input }).onConflictDoNothing({ target: revenueLedger.stripeObjectId });
}

/** The contract's Stripe invoice was paid (invoice.paid): mark it paid and add it to revenue, which funds the creator pool. */
export async function recordContractPaid(db: Database, input: { contractId: string; stripeInvoiceId: string; amountPaidCents: number; paidAt: Date }) {
  const { contract, org } = await loadContract(db, input.contractId);
  await db.transaction(async (tx) => {
    await tx
      .update(organizationContracts)
      .set({ status: "paid", paidAt: input.paidAt, stripeInvoiceId: contract.stripeInvoiceId ?? input.stripeInvoiceId })
      .where(and(eq(organizationContracts.id, contract.id), inArray(organizationContracts.status, ["draft", "invoiced"])));
    await addRevenue(tx, { stripeObjectId: input.stripeInvoiceId, amountCents: input.amountPaidCents, occurredAt: input.paidAt });
  });
  await syncOrgAccess(db, org.id, input.paidAt);
}

/**
 * Record a draft contract as paid without a Stripe invoice (a check, a wire, or free).
 * A contract that was invoiced is marked paid in Stripe instead ("paid out of band"),
 * which reaches us as invoice.paid.
 */
export async function markContractPaid(db: Database, input: { contractId: string; note: string; paidAt?: Date }) {
  const { contract, org } = await loadContract(db, input.contractId);
  const note = input.note.trim();
  if (!note) throw new OrgError("invalid", "Say how it was paid (for example, check number or wire reference).");
  if (contract.status !== "draft") {
    throw new OrgError("not_allowed", contract.status === "invoiced" ? "This contract has a Stripe invoice: mark the invoice paid in Stripe." : "This contract can't be marked paid.");
  }
  const paidAt = input.paidAt ?? new Date();
  await db.transaction(async (tx) => {
    await tx.update(organizationContracts).set({ status: "paid", paidAt, paymentNote: note }).where(eq(organizationContracts.id, contract.id));
    await addRevenue(tx, { stripeObjectId: `manual-contract-${contract.id}`, amountCents: contract.amountCents, occurredAt: paidAt });
  });
  await syncOrgAccess(db, org.id, paidAt);
}

/** Cancel a contract that hasn't been paid (voiding its Stripe invoice). Its access ends. */
export async function voidContract(db: Database, billing: OrgBilling, contractId: string, now: Date = new Date()) {
  const { contract, org } = await loadContract(db, contractId);
  if (contract.status === "paid") throw new OrgError("not_allowed", "A paid contract can't be voided. Refund it in Stripe first.");
  if (contract.status === "void") return;
  if (contract.status === "invoiced" && contract.stripeInvoiceId) await billing.voidInvoice(contract.stripeInvoiceId);
  await db.update(organizationContracts).set({ status: "void", voidedAt: now }).where(eq(organizationContracts.id, contract.id));
  await syncOrgAccess(db, org.id, now);
}

/** The invoice was voided in Stripe (invoice.voided). */
export async function recordInvoiceVoided(db: Database, stripeInvoiceId: string, now: Date = new Date()) {
  const [row] = await db
    .update(organizationContracts)
    .set({ status: "void", voidedAt: now })
    .where(and(eq(organizationContracts.stripeInvoiceId, stripeInvoiceId), eq(organizationContracts.status, "invoiced")))
    .returning({ orgId: organizationContracts.organizationId });
  if (row) await syncOrgAccess(db, row.orgId, now);
}

/**
 * Bring every seat's access in line with the organization's contracts: fathers with a
 * seat get access until the current term (and its renewals) ends; removed fathers and
 * organizations without a contract in force lose it. Safe to run any time.
 */
export async function syncOrgAccess(db: Db, orgId: string, now: Date = new Date()) {
  const window = accessWindow(await contractsFor(db, orgId), now);
  const seated = await db
    .select({ id: organizationMembers.id, userId: organizationMembers.userId, status: organizationMembers.status, removedAt: organizationMembers.removedAt })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.isManager, false), isNotNull(organizationMembers.userId)));

  for (const m of seated) {
    if (m.status === "active" && window.activeUntil) {
      await db
        .insert(subscriptions)
        .values({ userId: m.userId!, plan: "organization", status: "active", currentPeriodEnd: window.activeUntil, cancelAtPeriodEnd: true, organizationMemberId: m.id })
        .onConflictDoUpdate({ target: subscriptions.organizationMemberId, set: { status: "active", currentPeriodEnd: window.activeUntil } });
    } else {
      // Ends now (or when he was removed), never later than it already ends.
      const endedAt = m.status === "removed" && m.removedAt ? m.removedAt : now;
      await db
        .update(subscriptions)
        .set({ status: "canceled", currentPeriodEnd: sql`least(${subscriptions.currentPeriodEnd}, ${endedAt.toISOString()}::timestamptz)` })
        .where(and(eq(subscriptions.organizationMemberId, m.id), ne(subscriptions.status, "canceled")));
    }
  }
}

/** The daily run: starts access for contracts beginning today and follows renewals. */
export async function syncAllOrganizations(db: Database, now: Date = new Date()) {
  const ids = await db.select({ id: organizations.id }).from(organizations);
  for (const { id } of ids) await syncOrgAccess(db, id, now);
  return { organizations: ids.length };
}

// ---------------------------------------------------------------------------
// Invitations, join codes and seats
// ---------------------------------------------------------------------------

async function seatsTaken(db: Db, orgId: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.isManager, false), eq(organizationMembers.status, "active")));
  return row?.n ?? 0;
}

export type Invitation = { email: string; token: string; expiresAt: Date };

/**
 * Invite people by email, as fathers (each will use a seat when he joins) or as managers.
 * Someone already invited gets a fresh link; someone who already joined is skipped.
 */
export async function inviteMembers(
  db: Database,
  input: { orgId: string; emails: string[]; asManager: boolean; invitedById: string; now?: Date },
): Promise<{ invited: Invitation[]; alreadyJoined: string[] }> {
  if (input.emails.length === 0) throw new OrgError("invalid", "Add at least one email address.");
  if (input.emails.length > ORG_POLICY.maxInvitesPerBatch) throw new OrgError("invalid", `Invite up to ${ORG_POLICY.maxInvitesPerBatch} people at a time.`);
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + ORG_POLICY.inviteDays * DAY);
  const invited: Invitation[] = [];
  const alreadyJoined: string[] = [];
  for (const email of input.emails) {
    const { token, hash } = newInviteToken();
    const existing = await db.query.organizationMembers.findFirst({
      where: and(
        eq(organizationMembers.organizationId, input.orgId),
        eq(organizationMembers.email, email),
        eq(organizationMembers.isManager, input.asManager),
        ne(organizationMembers.status, "removed"),
      ),
    });
    if (existing?.status === "active") {
      alreadyJoined.push(email);
      continue;
    }
    if (existing) {
      await db.update(organizationMembers).set({ inviteTokenHash: hash, inviteExpiresAt: expiresAt, invitedById: input.invitedById }).where(eq(organizationMembers.id, existing.id));
    } else {
      await db.insert(organizationMembers).values({
        organizationId: input.orgId,
        email,
        isManager: input.asManager,
        status: "invited",
        inviteTokenHash: hash,
        inviteExpiresAt: expiresAt,
        invitedById: input.invitedById,
      });
    }
    invited.push({ email, token, expiresAt });
  }
  return { invited, alreadyJoined };
}

/** Email each invitation. Failures are reported, not thrown, so one bad address doesn't stop the rest. */
export async function sendInvitations(mailer: Mailer, input: { organization: string; asManager: boolean; appUrl: string; invited: Invitation[] }) {
  const failed: string[] = [];
  for (const inv of input.invited) {
    try {
      await mailer.send(
        inviteEmail({ email: inv.email, organization: input.organization, asManager: input.asManager, link: `${input.appUrl}/join/${inv.token}`, expiresOn: fmtDay(inv.expiresAt) }),
      );
    } catch (error) {
      console.error(`Invitation to ${inv.email} failed`, error);
      failed.push(inv.email);
    }
  }
  return { failed };
}

export async function revokeInvitation(db: Database, orgId: string, memberId: string) {
  const [row] = await db
    .update(organizationMembers)
    .set({ status: "removed", inviteTokenHash: null, removedAt: new Date() })
    .where(and(eq(organizationMembers.id, memberId), eq(organizationMembers.organizationId, orgId), eq(organizationMembers.status, "invited")))
    .returning({ id: organizationMembers.id });
  if (!row) throw new OrgError("not_found", "Invitation not found.");
}

/** What an invitation link is for, without using it. */
export async function invitationDetails(db: Database, token: string, now: Date = new Date()) {
  const [row] = await db
    .select({ member: organizationMembers, orgName: organizations.name, orgSlug: organizations.slug })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(eq(organizationMembers.inviteTokenHash, hashInviteToken(token)));
  if (!row || row.member.status !== "invited") return null;
  const expired = !row.member.inviteExpiresAt || row.member.inviteExpiresAt <= now;
  return { organization: row.orgName, slug: row.orgSlug, asManager: row.member.isManager, email: row.member.email, expired };
}

/** Check there's a seat for one more father (under the organization's row lock). */
async function assertSeat(tx: Tx, orgId: string, now: Date) {
  const window = accessWindow(await contractsFor(tx, orgId), now);
  if (!window.activeUntil && !window.startsAt) throw new OrgError("not_active", "This organization's license isn't active. Ask the person who invited you.");
  if ((await seatsTaken(tx, orgId)) >= window.seats) throw new OrgError("no_seats", "All of this organization's seats are taken. Ask the person who invited you to add one.");
}

async function lockOrg(tx: Tx, orgId: string) {
  await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, orgId)).for("update");
}

async function assertNotAlreadyIn(tx: Tx, orgId: string, userId: string, isManager: boolean) {
  const existing = await tx.query.organizationMembers.findFirst({
    where: and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.userId, userId), eq(organizationMembers.isManager, isManager), eq(organizationMembers.status, "active")),
  });
  if (existing) throw new OrgError("already_member", isManager ? "You already manage this organization." : "You've already joined this organization.");
}

/** Accept an invitation as the signed-in user. A father chooses whether to share his name and progress. */
export async function acceptInvitation(db: Database, input: { token: string; user: { id: string }; share: boolean; now?: Date }) {
  const now = input.now ?? new Date();
  const member = await db.query.organizationMembers.findFirst({ where: eq(organizationMembers.inviteTokenHash, hashInviteToken(input.token)) });
  if (!member || member.status !== "invited") throw new OrgError("used", "This invitation has already been used or was withdrawn.");
  if (!member.inviteExpiresAt || member.inviteExpiresAt <= now) throw new OrgError("expired", "This invitation has expired. Ask for a new one.");

  await db.transaction(async (tx) => {
    await lockOrg(tx, member.organizationId);
    await assertNotAlreadyIn(tx, member.organizationId, input.user.id, member.isManager);
    if (!member.isManager) await assertSeat(tx, member.organizationId, now);
    const [joined] = await tx
      .update(organizationMembers)
      .set({ userId: input.user.id, status: "active", joinedAt: now, inviteTokenHash: null, shareProgress: member.isManager ? false : input.share })
      .where(and(eq(organizationMembers.id, member.id), eq(organizationMembers.status, "invited")))
      .returning({ id: organizationMembers.id });
    if (!joined) throw new OrgError("used", "This invitation has already been used.");
  });
  await syncOrgAccess(db, member.organizationId, now);
  const org = await getOrganization(db, { id: member.organizationId });
  return { organization: org!, asManager: member.isManager };
}

/** Join with an organization's code (fathers only). Uses an outstanding invitation to the same address if there is one. */
export async function joinWithCode(db: Database, input: { code: string; user: { id: string; email: string }; share: boolean; now?: Date }) {
  const now = input.now ?? new Date();
  const code = normalizeJoinCode(input.code);
  const org = code ? await db.query.organizations.findFirst({ where: and(eq(organizations.joinCode, code), eq(organizations.joinCodeEnabled, true)) }) : null;
  if (!org) throw new OrgError("not_found", "We couldn't find that code. Check it with the person who gave it to you.");
  const email = input.user.email.trim().toLowerCase();

  await db.transaction(async (tx) => {
    await lockOrg(tx, org.id);
    await assertNotAlreadyIn(tx, org.id, input.user.id, false);
    await assertSeat(tx, org.id, now);
    const pending = await tx.query.organizationMembers.findFirst({
      where: and(eq(organizationMembers.organizationId, org.id), eq(organizationMembers.email, email), eq(organizationMembers.isManager, false), eq(organizationMembers.status, "invited")),
    });
    if (pending) {
      await tx
        .update(organizationMembers)
        .set({ userId: input.user.id, status: "active", joinedAt: now, inviteTokenHash: null, shareProgress: input.share })
        .where(eq(organizationMembers.id, pending.id));
    } else {
      await tx.insert(organizationMembers).values({ organizationId: org.id, userId: input.user.id, email, status: "active", joinedAt: now, shareProgress: input.share });
    }
  });
  await syncOrgAccess(db, org.id, now);
  return org;
}

/** A father changes whether his organization sees his name and progress. */
export async function setSharing(db: Database, input: { userId: string; memberId: string; share: boolean }) {
  const [row] = await db
    .update(organizationMembers)
    .set({ shareProgress: input.share })
    .where(and(eq(organizationMembers.id, input.memberId), eq(organizationMembers.userId, input.userId), eq(organizationMembers.isManager, false), eq(organizationMembers.status, "active")))
    .returning({ id: organizationMembers.id });
  if (!row) throw new OrgError("not_found", "Membership not found.");
}

async function endMembership(db: Database, where: ReturnType<typeof and>, now: Date) {
  const [row] = await db
    .update(organizationMembers)
    .set({ status: "removed", removedAt: now, inviteTokenHash: null })
    .where(and(where, eq(organizationMembers.status, "active")))
    .returning({ orgId: organizationMembers.organizationId });
  if (!row) throw new OrgError("not_found", "Membership not found.");
  await syncOrgAccess(db, row.orgId, now);
}

/** A father (or manager) leaves. His own account and progress stay; the seat frees up. */
export const leaveOrganization = (db: Database, input: { userId: string; memberId: string; now?: Date }) =>
  endMembership(db, and(eq(organizationMembers.id, input.memberId), eq(organizationMembers.userId, input.userId)), input.now ?? new Date());

/** A manager or our team removes someone from the organization. */
export const removeMember = (db: Database, input: { orgId: string; memberId: string; now?: Date }) =>
  endMembership(db, and(eq(organizationMembers.id, input.memberId), eq(organizationMembers.organizationId, input.orgId)), input.now ?? new Date());

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

/** The organizations a person belongs to (as a father or a manager), with access dates for seats. */
export async function membershipsFor(db: Database, userId: string) {
  return db
    .select({
      id: organizationMembers.id,
      isManager: organizationMembers.isManager,
      shareProgress: organizationMembers.shareProgress,
      joinedAt: organizationMembers.joinedAt,
      orgName: organizations.name,
      orgSlug: organizations.slug,
      accessUntil: subscriptions.currentPeriodEnd,
      accessStatus: subscriptions.status,
    })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .leftJoin(subscriptions, eq(subscriptions.organizationMemberId, organizationMembers.id))
    .where(and(eq(organizationMembers.userId, userId), eq(organizationMembers.status, "active")))
    .orderBy(asc(organizations.name));
}

/** True when the person manages this organization. */
export async function isManagerOf(db: Database, userId: string, orgId: string): Promise<boolean> {
  const row = await db.query.organizationMembers.findFirst({
    where: and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.userId, userId), eq(organizationMembers.isManager, true), eq(organizationMembers.status, "active")),
    columns: { id: true },
  });
  return Boolean(row);
}

/** Every organization for the admin list: current seats and use. */
export async function listOrganizations(db: Database, now: Date = new Date()) {
  const [orgs, contracts, taken] = await Promise.all([
    db.select().from(organizations).orderBy(asc(organizations.name)),
    db.select().from(organizationContracts),
    db
      .select({ orgId: organizationMembers.organizationId, n: sql<number>`count(*)::int` })
      .from(organizationMembers)
      .where(and(eq(organizationMembers.isManager, false), eq(organizationMembers.status, "active")))
      .groupBy(organizationMembers.organizationId),
  ]);
  const takenBy = new Map(taken.map((t) => [t.orgId, t.n]));
  return orgs.map((o) => {
    const mine = contracts.filter((c) => c.organizationId === o.id);
    return {
      ...o,
      window: accessWindow(mine, now),
      seatsUsed: takenBy.get(o.id) ?? 0,
      unpaidCents: mine.filter((c) => c.status === "invoiced").reduce((t, c) => t + c.amountCents, 0),
      paidCents: mine.filter((c) => c.status === "paid").reduce((t, c) => t + c.amountCents, 0),
    };
  });
}

/** People in the organization for the manager and admin pages (no progress: see reports.ts). */
export async function organizationPeople(db: Database, orgId: string, now: Date = new Date()) {
  const rows = await db
    .select({
      id: organizationMembers.id,
      email: organizationMembers.email,
      name: user.name,
      isManager: organizationMembers.isManager,
      status: organizationMembers.status,
      shareProgress: organizationMembers.shareProgress,
      joinedAt: organizationMembers.joinedAt,
      inviteExpiresAt: organizationMembers.inviteExpiresAt,
      invitedAt: organizationMembers.createdAt,
    })
    .from(organizationMembers)
    .leftJoin(user, eq(user.id, organizationMembers.userId))
    .where(and(eq(organizationMembers.organizationId, orgId), or(eq(organizationMembers.status, "active"), and(eq(organizationMembers.status, "invited"), gt(organizationMembers.inviteExpiresAt, now)))))
    .orderBy(asc(organizationMembers.email));
  return {
    managers: rows.filter((r) => r.isManager && r.status === "active"),
    fathers: rows.filter((r) => !r.isManager && r.status === "active"),
    invited: rows.filter((r) => r.status === "invited"),
  };
}
