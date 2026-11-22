/**
 * Organization licenses against a real Postgres, with a fake Stripe: contracts and
 * invoices, invitations and join codes, seats, access, reports and revenue. Runs
 * only when TEST_DATABASE_URL points at a disposable database (tables are truncated).
 */
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import type { EmailMessage, Mailer } from "@/lib/email";
import { hasActiveMembership } from "@/lib/entitlements";
import { monthPeriod } from "@/lib/revenue/pool";
import { settlePeriod } from "@/lib/revenue/settlement";
import { organizationReport, progressCsv } from "./reports";
import {
  acceptInvitation,
  createContract,
  createOrganization,
  invitationDetails,
  inviteMembers,
  isManagerOf,
  joinWithCode,
  leaveOrganization,
  markContractPaid,
  membershipsFor,
  OrgError,
  organizationPeople,
  recordContractPaid,
  recordInvoiceVoided,
  removeMember,
  revokeInvitation,
  sendContractInvoice,
  sendInvitations,
  setJoinCode,
  setSharing,
  syncAllOrganizations,
  voidContract,
  type OrgBilling,
} from "./service";

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-22T15:00:00Z");
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

class FakeBilling implements OrgBilling {
  customers = 0;
  invoices: { customerId: string; contractId: string; amountCents: number; description: string }[] = [];
  voided: string[] = [];
  async ensureCustomer(org: { stripeCustomerId: string | null }) {
    if (org.stripeCustomerId) return org.stripeCustomerId;
    this.customers++;
    return `cus_${this.customers}`;
  }
  async sendInvoice(input: { customerId: string; contractId: string; amountCents: number; description: string }) {
    this.invoices.push(input);
    return { invoiceId: `in_${this.invoices.length}`, invoiceUrl: `https://invoice.test/${this.invoices.length}` };
  }
  async voidInvoice(id: string) {
    this.voided.push(id);
  }
}

class RecordingMailer implements Mailer {
  sent: EmailMessage[] = [];
  async send(m: EmailMessage) {
    if (m.to.startsWith("bounce")) throw new Error("bounced");
    this.sent.push(m);
  }
}

describe.skipIf(!url)("organizations (Postgres)", () => {
  let client: postgres.Sql;
  let db: Database;
  let billing: FakeBilling;

  beforeAll(async () => {
    client = postgres(url!, { max: 4, onnotice: () => {} });
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: "drizzle" });
  });

  afterAll(async () => {
    await client?.end();
  });

  beforeEach(async () => {
    await db.execute(sql`truncate organization_members, organization_contracts, organizations, subscriptions, revenue_ledger, pool_calculations, certificates, watch_progress, watch_sessions, lessons, course_modules, courses, videos, "user" cascade`);
    await db.insert(schema.user).values([
      { id: "admin", name: "Ada Admin", email: "admin@test.dev", role: "admin" },
      { id: "dad1", name: "Marcus Lee", email: "marcus@test.dev" },
      { id: "dad2", name: "Sam Cole", email: "sam@test.dev" },
      { id: "dad3", name: "Ray Diaz", email: "ray@test.dev" },
      { id: "mgr", name: "Pat Manager", email: "pat@program.org" },
    ]);
    billing = new FakeBilling();
  });

  const subsOf = (userId: string) => db.select().from(schema.subscriptions).where(eq(schema.subscriptions.userId, userId));
  const hasAccess = async (userId: string, at = NOW) => hasActiveMembership(await subsOf(userId), at);
  const contract = async (id: string) => (await db.query.organizationContracts.findFirst({ where: eq(schema.organizationContracts.id, id) }))!;

  async function orgWithContract(seats = 2, start = "2026-11-01", end = "2027-11-01") {
    const org = await createOrganization(db, { name: "Dads Forward", kind: "nonprofit", contactName: "Jo", contactEmail: "Billing@DadsForward.org" });
    const c = await createContract(db, { orgId: org.id, seats, pricePerSeatCents: 99_00, startsAt: day(start), endsAt: day(end), createdById: "admin" });
    await sendContractInvoice(db, billing, c.id, NOW);
    return { org, contract: c };
  }

  async function invite(orgId: string, emails: string[], asManager = false) {
    return (await inviteMembers(db, { orgId, emails, asManager, invitedById: "admin", now: NOW })).invited;
  }

  it("gives organizations unique addresses and checks contracts", async () => {
    const a = await createOrganization(db, { name: "Dads Forward", kind: "nonprofit", contactName: null, contactEmail: "a@x.org" });
    const b = await createOrganization(db, { name: "Dads Forward!", kind: "employer", contactName: null, contactEmail: "b@x.org" });
    expect([a.slug, b.slug, a.contactEmail]).toEqual(["dads-forward", "dads-forward-2", "a@x.org"]);
    await expect(createContract(db, { orgId: a.id, seats: 0, pricePerSeatCents: 100, startsAt: day("2026-01-01"), endsAt: day("2027-01-01"), createdById: "admin" })).rejects.toThrow("at least one seat");
    await expect(createContract(db, { orgId: a.id, seats: 5, pricePerSeatCents: 100, startsAt: day("2027-01-01"), endsAt: day("2026-01-01"), createdById: "admin" })).rejects.toThrow("after the start");
  });

  it("invoices a contract through Stripe, once", async () => {
    const { org, contract: c } = await orgWithContract(40);
    expect(billing.invoices).toEqual([
      { customerId: "cus_1", contractId: c.id, amountCents: 3_960_00, daysUntilDue: 30, description: "Fatherhood.School licenses: 40 seats, Nov 1, 2026 to Oct 31, 2027" },
    ]);
    expect(await contract(c.id)).toMatchObject({ status: "invoiced", stripeInvoiceId: "in_1", invoiceUrl: "https://invoice.test/1", amountCents: 3_960_00 });
    expect((await db.query.organizations.findFirst({ where: eq(schema.organizations.id, org.id) }))?.stripeCustomerId).toBe("cus_1");
    await expect(sendContractInvoice(db, billing, c.id, NOW)).rejects.toMatchObject({ reason: "not_allowed" });
  });

  it("lets an invited father join with a seat, and records his choice to share", async () => {
    const { org } = await orgWithContract(2);
    const mailer = new RecordingMailer();
    const invited = await invite(org.id, ["marcus@test.dev", "bounce@test.dev"]);
    expect(await sendInvitations(mailer, { organization: org.name, asManager: false, appUrl: "https://fs.test", invited })).toEqual({ failed: ["bounce@test.dev"] });
    expect(mailer.sent[0]!.text).toContain(`https://fs.test/join/${invited[0]!.token}`);
    expect(await invitationDetails(db, invited[0]!.token, NOW)).toMatchObject({ organization: "Dads Forward", asManager: false, expired: false });

    await acceptInvitation(db, { token: invited[0]!.token, user: { id: "dad1" }, share: true, now: NOW });
    expect(await hasAccess("dad1")).toBe(true);
    expect(await subsOf("dad1")).toMatchObject([{ plan: "organization", status: "active", currentPeriodEnd: day("2027-11-01"), stripeSubscriptionId: null }]);
    expect(await membershipsFor(db, "dad1")).toMatchObject([{ orgName: "Dads Forward", isManager: false, shareProgress: true, accessUntil: day("2027-11-01") }]);
    await expect(acceptInvitation(db, { token: invited[0]!.token, user: { id: "dad1" }, share: true, now: NOW })).rejects.toMatchObject({ reason: "used" });

    await setSharing(db, { userId: "dad1", memberId: (await membershipsFor(db, "dad1"))[0]!.id, share: false });
    expect((await membershipsFor(db, "dad1"))[0]?.shareProgress).toBe(false);
  });

  it("refuses expired, withdrawn and over-capacity invitations", async () => {
    const { org } = await orgWithContract(1);
    const [a, b, c] = await invite(org.id, ["marcus@test.dev", "sam@test.dev", "ray@test.dev"]);
    await expect(acceptInvitation(db, { token: a!.token, user: { id: "dad1" }, share: false, now: new Date(NOW.getTime() + 31 * 86_400_000) })).rejects.toMatchObject({ reason: "expired" });

    await acceptInvitation(db, { token: a!.token, user: { id: "dad1" }, share: false, now: NOW });
    await expect(acceptInvitation(db, { token: b!.token, user: { id: "dad2" }, share: false, now: NOW })).rejects.toMatchObject({ reason: "no_seats" });
    expect(await hasAccess("dad2")).toBe(false);

    const people = await organizationPeople(db, org.id, NOW);
    await revokeInvitation(db, org.id, people.invited.find((p) => p.email === "ray@test.dev")!.id);
    await expect(acceptInvitation(db, { token: c!.token, user: { id: "dad3" }, share: false, now: NOW })).rejects.toMatchObject({ reason: "used" });

    // Inviting again re-issues the link; someone already in is skipped.
    const again = await inviteMembers(db, { orgId: org.id, emails: ["sam@test.dev", "marcus@test.dev"], asManager: false, invitedById: "admin", now: NOW });
    expect(again.invited.map((i) => i.email)).toEqual(["sam@test.dev"]);
    expect(again.alreadyJoined).toEqual(["marcus@test.dev"]);
  });

  it("lets fathers join with a code only while it's on, using a pending invitation if there is one", async () => {
    const { org } = await orgWithContract(5);
    await expect(joinWithCode(db, { code: "ORG-2222-2222", user: { id: "dad1", email: "marcus@test.dev" }, share: false, now: NOW })).rejects.toMatchObject({ reason: "not_found" });
    const withCode = await setJoinCode(db, org.id, { enabled: true });
    await invite(org.id, ["sam@test.dev"]);

    await joinWithCode(db, { code: withCode.joinCode!.toLowerCase(), user: { id: "dad2", email: "Sam@test.dev" }, share: true, now: NOW });
    const people = await organizationPeople(db, org.id, NOW);
    expect(people.fathers.map((f) => [f.email, f.shareProgress])).toEqual([["sam@test.dev", true]]);
    expect(people.invited).toEqual([]);
    expect(await hasAccess("dad2")).toBe(true);
    await expect(joinWithCode(db, { code: withCode.joinCode!, user: { id: "dad2", email: "sam@test.dev" }, share: true, now: NOW })).rejects.toMatchObject({ reason: "already_member" });

    const rotated = await setJoinCode(db, org.id, { enabled: true, rotate: true });
    expect(rotated.joinCode).not.toBe(withCode.joinCode);
    await expect(joinWithCode(db, { code: withCode.joinCode!, user: { id: "dad1", email: "marcus@test.dev" }, share: false, now: NOW })).rejects.toBeInstanceOf(OrgError);
  });

  it("makes managers, who use no seat", async () => {
    const { org } = await orgWithContract(1);
    const [m] = await invite(org.id, ["pat@program.org"], true);
    await acceptInvitation(db, { token: m!.token, user: { id: "mgr" }, share: true, now: NOW });
    expect(await isManagerOf(db, "mgr", org.id)).toBe(true);
    expect(await hasAccess("mgr")).toBe(false);
    const [f] = await invite(org.id, ["marcus@test.dev"]);
    await acceptInvitation(db, { token: f!.token, user: { id: "dad1" }, share: false, now: NOW });
    expect(await hasAccess("dad1")).toBe(true);
  });

  it("ends access when a father is removed or leaves, keeping the seat free", async () => {
    const { org } = await orgWithContract(1);
    const [a] = await invite(org.id, ["marcus@test.dev"]);
    await acceptInvitation(db, { token: a!.token, user: { id: "dad1" }, share: false, now: NOW });
    const memberId = (await membershipsFor(db, "dad1"))[0]!.id;
    await removeMember(db, { orgId: org.id, memberId, now: NOW });
    expect(await hasAccess("dad1", new Date(NOW.getTime() + 1000))).toBe(false);

    const [b] = await invite(org.id, ["sam@test.dev"]);
    await acceptInvitation(db, { token: b!.token, user: { id: "dad2" }, share: false, now: NOW });
    await leaveOrganization(db, { userId: "dad2", memberId: (await membershipsFor(db, "dad2"))[0]!.id, now: NOW });
    expect(await hasAccess("dad2", new Date(NOW.getTime() + 1000))).toBe(false);
    await expect(leaveOrganization(db, { userId: "dad2", memberId: "00000000-0000-4000-8000-000000000000" })).rejects.toMatchObject({ reason: "not_found" });
  });

  it("records payment from Stripe once, into the revenue that funds the creator pool", async () => {
    const { contract: c } = await orgWithContract(10);
    await recordContractPaid(db, { contractId: c.id, stripeInvoiceId: "in_1", amountPaidCents: 990_00, paidAt: day("2026-11-10") });
    await recordContractPaid(db, { contractId: c.id, stripeInvoiceId: "in_1", amountPaidCents: 990_00, paidAt: day("2026-11-10") });
    expect(await contract(c.id)).toMatchObject({ status: "paid", paidAt: day("2026-11-10") });
    const ledger = await db.select().from(schema.revenueLedger);
    expect(ledger.map((l) => [l.kind, l.stripeObjectId, l.amountCents])).toEqual([["organization", "in_1", 990_00]]);
    const settled = await settlePeriod(db, monthPeriod(2026, 11));
    expect(settled).toMatchObject({ subscriptionRevenueCents: 990_00, poolCents: 247_50 });
    await expect(voidContract(db, billing, c.id, NOW)).rejects.toMatchObject({ reason: "not_allowed" });
  });

  it("records a payment made outside Stripe, only for a contract with no invoice", async () => {
    const org = await createOrganization(db, { name: "Base Family Center", kind: "military", contactName: null, contactEmail: "fc@base.mil" });
    const c = await createContract(db, { orgId: org.id, seats: 3, pricePerSeatCents: 50_00, startsAt: day("2026-11-01"), endsAt: day("2027-11-01"), createdById: "admin" });
    await expect(markContractPaid(db, { contractId: c.id, note: " " })).rejects.toMatchObject({ reason: "invalid" });
    await markContractPaid(db, { contractId: c.id, note: "Check #1042", paidAt: NOW });
    expect(await contract(c.id)).toMatchObject({ status: "paid", paymentNote: "Check #1042" });
    expect((await db.select().from(schema.revenueLedger)).map((l) => [l.kind, l.stripeObjectId, l.amountCents])).toEqual([["organization", `manual-contract-${c.id}`, 150_00]]);

    const { contract: invoiced } = await orgWithContract(2);
    await expect(markContractPaid(db, { contractId: invoiced.id, note: "wire" })).rejects.toThrow("mark the invoice paid in Stripe");
  });

  it("voids an unpaid contract, here or in Stripe, ending its access", async () => {
    const { org, contract: c } = await orgWithContract(2);
    const [a] = await invite(org.id, ["marcus@test.dev"]);
    await acceptInvitation(db, { token: a!.token, user: { id: "dad1" }, share: false, now: NOW });
    await voidContract(db, billing, c.id, NOW);
    expect(billing.voided).toEqual(["in_1"]);
    expect(await contract(c.id)).toMatchObject({ status: "void" });
    expect(await hasAccess("dad1", new Date(NOW.getTime() + 1000))).toBe(false);

    const second = await createContract(db, { orgId: org.id, seats: 2, pricePerSeatCents: 99_00, startsAt: day("2026-11-01"), endsAt: day("2027-11-01"), createdById: "admin" });
    await sendContractInvoice(db, billing, second.id, NOW);
    expect(await hasAccess("dad1")).toBe(true);
    await recordInvoiceVoided(db, "in_2", NOW);
    expect(await hasAccess("dad1", new Date(NOW.getTime() + 1000))).toBe(false);
  });

  it("starts access when a future contract begins, and extends it on renewal", async () => {
    const { org, contract: first } = await orgWithContract(2, "2026-12-01", "2027-12-01");
    const [a] = await invite(org.id, ["marcus@test.dev"]);
    await acceptInvitation(db, { token: a!.token, user: { id: "dad1" }, share: false, now: NOW });
    expect(await hasAccess("dad1")).toBe(false);

    await syncAllOrganizations(db, day("2026-12-01"));
    expect(await hasAccess("dad1", day("2026-12-02"))).toBe(true);

    const renewal = await createContract(db, { orgId: org.id, seats: 2, pricePerSeatCents: 99_00, startsAt: day("2027-12-01"), endsAt: day("2028-12-01"), createdById: "admin" });
    await sendContractInvoice(db, billing, renewal.id, day("2027-10-01"));
    expect((await subsOf("dad1"))[0]?.currentPeriodEnd).toEqual(day("2028-12-01"));
    expect(first.id).not.toBe(renewal.id);
  });

  it("reports totals, and names and progress only for fathers who share", async () => {
    const { org } = await orgWithContract(10);
    const join = async (userId: string, email: string, share: boolean) => {
      const [inv] = await invite(org.id, [email]);
      await acceptInvitation(db, { token: inv!.token, user: { id: userId }, share, now: NOW });
    };
    await join("dad1", "marcus@test.dev", true);
    await join("dad2", "sam@test.dev", false);
    const [lessonVideo] = await db.insert(schema.videos).values({ type: "professional", status: "approved", creatorId: "admin", title: "L", requireSignedUrls: true }).returning();
    const [course] = await db.insert(schema.courses).values({ slug: "c", title: "Presence", published: true }).returning();
    const [mod] = await db.insert(schema.courseModules).values({ courseId: course!.id, title: "M", position: 1 }).returning();
    await db.insert(schema.lessons).values({ moduleId: mod!.id, videoId: lessonVideo!.id, title: "L", position: 1 });
    for (const userId of ["dad1", "dad2"]) {
      await db.insert(schema.watchProgress).values({ userId, videoId: lessonVideo!.id, completed: true });
      await db.insert(schema.watchSessions).values({ userId, videoId: lessonVideo!.id, secondsWatched: 1800, startedAt: new Date(NOW.getTime() + 1000), lastHeartbeatAt: new Date(NOW.getTime() + 2000) });
    }
    await db.insert(schema.certificates).values({ userId: "dad1", courseId: course!.id, code: "FS-AAAA-AAAA", recipientName: "Marcus Lee", courseTitle: "Presence" });

    const report = (await organizationReport(db, org.id, new Date(NOW.getTime() + 3000)))!;
    expect(report.seats).toEqual({ total: 10, used: 2, invited: 0 });
    // One father keeps his progress private, so the totals cover only the father who shares.
    expect(report.totals).toEqual({ coverage: "sharing_only", fathers: 1, activeLast30: 1, lessonsCompleted: 1, certificates: 1, watchSeconds: 1800 });
    expect(report.people.map((p) => [p.name, p.shares, p.progress?.lessonsCompleted ?? null])).toEqual([
      ["Marcus Lee", true, 1],
      ["Sam Cole", false, null],
    ]);
    const csv = progressCsv(report);
    expect(csv).toContain("Marcus Lee,marcus@test.dev,2026-11-22,1,0.5,Presence,2026-11-22");
    expect(csv).not.toContain("Sam");
  });

  it("defuses spreadsheet formulas in exported names", async () => {
    const { org } = await orgWithContract(1);
    await db.update(schema.user).set({ name: "=HYPERLINK(\"x\")" }).where(eq(schema.user.id, "dad1"));
    const [inv] = await invite(org.id, ["marcus@test.dev"]);
    await acceptInvitation(db, { token: inv!.token, user: { id: "dad1" }, share: true, now: NOW });
    const csv = progressCsv((await organizationReport(db, org.id, NOW))!);
    expect(csv.split("\r\n")[1]).toMatch(/^"'=HYPERLINK\(""x""\)",/);
    expect(await db.select().from(schema.organizationMembers).where(and(eq(schema.organizationMembers.organizationId, org.id)))).toHaveLength(1);
  });
});
