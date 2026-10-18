/**
 * Creator payouts against a real Postgres, with a fake Stripe. Runs only when
 * TEST_DATABASE_URL points at a disposable database (tables are truncated).
 */
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import type { EmailMessage, Mailer } from "@/lib/email";
import type { AccountState, ConnectGateway, TransferRequest } from "./gateway";
import {
  applyAccountState,
  markDisconnected,
  payoutAccount,
  payoutQueue,
  payoutState,
  payoutTotals,
  refreshAccount,
  remindAccountSetup,
  requeuePayout,
  sendPayouts,
  startOnboarding,
} from "./service";

const url = process.env.TEST_DATABASE_URL;
const T0 = new Date("2026-11-06T15:00:00Z");
const hours = (h: number) => new Date(T0.getTime() + h * 3_600_000);

class FakeGateway implements ConnectGateway {
  accounts = new Map<string, AccountState>();
  transfers: (TransferRequest & { id: string })[] = [];
  failNext: { code: string; message: string } | null = null;
  links = 0;
  async createAccount({ userId }: { userId: string }) {
    const state: AccountState = { id: `acct_${userId}`, detailsSubmitted: false, payoutsEnabled: false, requirementsDue: ["external_account"], disabledReason: null, country: "US" };
    this.accounts.set(state.id, state);
    return state;
  }
  async retrieveAccount(id: string) {
    return this.accounts.get(id)!;
  }
  async onboardingLink(id: string) {
    this.links++;
    return `https://connect.stripe.test/setup/${id}`;
  }
  async dashboardLink(id: string) {
    return `https://connect.stripe.test/express/${id}`;
  }
  async findTransfer(group: string) {
    const t = this.transfers.find((x) => x.group === group);
    return t ? { id: t.id } : null;
  }
  async createTransfer(request: TransferRequest) {
    if (this.failNext) {
      const error = Object.assign(new Error(this.failNext.message), { code: this.failNext.code });
      this.failNext = null;
      throw error;
    }
    const id = `tr_${this.transfers.length + 1}`;
    this.transfers.push({ ...request, id });
    return { id };
  }
  async availableBalanceCents() {
    return 1_000_00;
  }
  verify(id: string, payoutsEnabled = true) {
    this.accounts.set(id, { ...this.accounts.get(id)!, detailsSubmitted: true, payoutsEnabled, requirementsDue: [] });
    return this.accounts.get(id)!;
  }
}

class FakeMailer implements Mailer {
  sent: EmailMessage[] = [];
  async send(message: EmailMessage) {
    this.sent.push(message);
  }
}

describe.skipIf(!url)("creator payouts (Postgres)", () => {
  let client: postgres.Sql;
  let db: Database;
  let gateway: FakeGateway;
  let mailer: FakeMailer;

  beforeAll(async () => {
    client = postgres(url!, { max: 4, onnotice: () => {} });
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: "drizzle" });
  });

  afterAll(async () => {
    await client?.end();
  });

  beforeEach(async () => {
    await db.execute(sql`truncate pool_shares, pool_calculations, creator_payouts, payout_accounts, "user" cascade`);
    await db.insert(schema.user).values(["a", "b", "c"].map((k) => ({ id: k, name: `Creator ${k.toUpperCase()}`, email: `${k}@test.dev`, role: "creator" as const })));
    gateway = new FakeGateway();
    mailer = new FakeMailer();
  });

  async function payout(creatorId: string, amountCents: number, extra: Partial<typeof schema.creatorPayouts.$inferInsert> = {}) {
    const [row] = await db
      .insert(schema.creatorPayouts)
      .values({ creatorId, amountCents, periodStart: new Date("2026-10-01T00:00:00Z"), periodEnd: new Date("2026-11-01T00:00:00Z"), createdAt: hours(-24), ...extra })
      .returning();
    return row!;
  }
  async function connect(userId: string, payoutsEnabled = true) {
    await startOnboarding(db, gateway, { id: userId, email: `${userId}@test.dev` }, { refreshUrl: "r", returnUrl: "s" });
    await applyAccountState(db, gateway.verify(`acct_${userId}`, payoutsEnabled));
  }
  const get = async (id: string) => (await db.select().from(schema.creatorPayouts).where(eq(schema.creatorPayouts.id, id)))[0]!;
  const notify = () => ({ mailer, appUrl: "https://fatherhood.school" });

  it("onboards each creator once and mirrors Stripe's account state", async () => {
    const link = await startOnboarding(db, gateway, { id: "a", email: "a@test.dev" }, { refreshUrl: "r", returnUrl: "s" });
    expect(link).toBe("https://connect.stripe.test/setup/acct_a");
    await startOnboarding(db, gateway, { id: "a", email: "a@test.dev" }, { refreshUrl: "r", returnUrl: "s" });
    expect(gateway.accounts.size).toBe(1);
    expect(await payoutAccount(db, "a")).toMatchObject({ stripeAccountId: "acct_a", detailsSubmitted: false, payoutsEnabled: false, requirementsDue: ["external_account"] });

    gateway.verify("acct_a");
    expect(await refreshAccount(db, gateway, "a")).toMatchObject({ detailsSubmitted: true, payoutsEnabled: true, requirementsDue: [] });
    expect(await refreshAccount(db, gateway, "b")).toBeNull();

    await markDisconnected(db, "acct_a");
    expect(await payoutAccount(db, "a")).toMatchObject({ payoutsEnabled: false, disabledReason: "disconnected" });
  });

  it("sends payouts to ready accounts only, and tells the creator", async () => {
    await connect("a");
    await connect("c", false);
    const pa = await payout("a", 25_00);
    const pb = await payout("b", 40_00);
    const pc = await payout("c", 30_00);

    const result = await sendPayouts(db, gateway, { now: T0, notify: notify() });
    expect(result).toEqual({ paid: [{ id: pa.id, creatorId: "a", amountCents: 25_00, transferId: "tr_1" }], failed: [] });
    expect(gateway.transfers[0]).toMatchObject({ amountCents: 25_00, destination: "acct_a", group: `payout_${pa.id}`, idempotencyKey: `payout_${pa.id}_attempt_1`, metadata: { payoutId: pa.id, creatorId: "a" } });
    expect(gateway.transfers[0]!.description).toBe("Fatherhood.School creator pool, Oct 2026–Oct 2026");
    expect(await get(pa.id)).toMatchObject({ status: "paid", stripeTransferId: "tr_1", paidAt: T0, attempts: 1 });
    expect((await get(pb.id)).status).toBe("pending");
    expect((await get(pc.id)).status).toBe("pending");
    expect(mailer.sent.map((m) => `${m.to}: ${m.subject}`)).toEqual(["a@test.dev: You've been paid $25.00"]);

    // Nothing is sent twice.
    expect(await sendPayouts(db, gateway, { now: hours(1) })).toEqual({ paid: [], failed: [] });

    // Once Stripe verifies C, the next run pays them.
    await applyAccountState(db, gateway.verify("acct_c"));
    expect((await sendPayouts(db, gateway, { now: hours(2) })).paid.map((p) => p.creatorId)).toEqual(["c"]);

    const states = Object.fromEntries((await payoutQueue(db)).map((r) => [r.creatorName, payoutState(r)]));
    expect(states).toEqual({ "Creator A": "paid", "Creator B": "needs_account", "Creator C": "paid" });
    expect(await payoutTotals(db)).toEqual({ ready: { count: 0, cents: 0 }, waitingOnCreators: { count: 1, cents: 40_00 }, failed: { count: 0, cents: 0 } });
  });

  it("finds a transfer an interrupted run already made instead of paying again", async () => {
    await connect("a");
    const pa = await payout("a", 25_00, { status: "processing", attempts: 1, lastAttemptAt: hours(-1) });
    // The earlier run created the transfer, then crashed before recording it.
    gateway.transfers.push({ id: "tr_earlier", amountCents: 25_00, destination: "acct_a", group: `payout_${pa.id}`, description: "", metadata: {}, idempotencyKey: "k" });

    // A run inside the lease leaves it alone; after the lease it's recovered.
    await db.update(schema.creatorPayouts).set({ lastAttemptAt: hours(-0.1) });
    expect((await sendPayouts(db, gateway, { now: T0 })).paid).toEqual([]);
    await db.update(schema.creatorPayouts).set({ lastAttemptAt: hours(-1) });
    const result = await sendPayouts(db, gateway, { now: T0 });
    expect(result.paid).toEqual([{ id: pa.id, creatorId: "a", amountCents: 25_00, transferId: "tr_earlier" }]);
    expect(gateway.transfers).toHaveLength(1);
  });

  it("retries failed transfers after a wait, up to a limit, then waits for an admin", async () => {
    await connect("a");
    const pa = await payout("a", 25_00);
    gateway.failNext = { code: "balance_insufficient", message: "Insufficient funds" };
    const first = await sendPayouts(db, gateway, { now: T0 });
    expect(first.failed).toEqual([{ id: pa.id, creatorId: "a", amountCents: 25_00, reason: expect.stringMatching(/Not enough available balance/) }]);
    expect(await get(pa.id)).toMatchObject({ status: "failed", attempts: 1 });

    expect((await sendPayouts(db, gateway, { now: hours(1) })).failed).toEqual([]);
    for (let i = 2; i <= 5; i++) {
      gateway.failNext = { code: "api_error", message: "Stripe is down" };
      await sendPayouts(db, gateway, { now: hours(6 * i) });
    }
    expect(await get(pa.id)).toMatchObject({ status: "failed", attempts: 5, failureReason: "Stripe: Stripe is down" });
    expect(await sendPayouts(db, gateway, { now: hours(100) })).toEqual({ paid: [], failed: [] });
    expect(payoutState((await payoutQueue(db))[0]!)).toBe("failed");

    await requeuePayout(db, pa.id);
    await expect(requeuePayout(db, pa.id)).rejects.toMatchObject({ reason: "not_found" });
    const sent = await sendPayouts(db, gateway, { now: hours(101) });
    expect(sent.paid).toHaveLength(1);
    // Each attempt had its own idempotency key; the transfer group is the guard against paying twice.
    expect(gateway.transfers[0]!.idempotencyKey).toBe(`payout_${pa.id}_attempt_6`);
  });

  it("sends only the chosen payouts when asked, without the retry wait", async () => {
    await connect("a");
    await connect("b");
    const pa = await payout("a", 25_00, { status: "failed", attempts: 1, lastAttemptAt: T0 });
    await payout("b", 40_00);
    const result = await sendPayouts(db, gateway, { now: hours(0.5), ids: [pa.id] });
    expect(result.paid.map((p) => p.creatorId)).toEqual(["a"]);
    expect(await db.$count(schema.creatorPayouts, eq(schema.creatorPayouts.status, "pending"))).toBe(1);
  });

  it("reminds creators with money waiting to set up payouts, weekly", async () => {
    await connect("c", false);
    await payout("b", 40_00);
    await payout("b", 22_50, { periodStart: new Date("2026-09-01T00:00:00Z") });
    await payout("c", 30_00);
    await connect("a");
    await payout("a", 25_00);

    // One email per creator, with their total.
    expect(await remindAccountSetup(db, mailer, "https://fatherhood.school", T0)).toBe(2);
    expect(mailer.sent.map((m) => m.subject).sort()).toEqual(["Set up payouts to receive $30.00", "Set up payouts to receive $62.50"]);
    expect(await remindAccountSetup(db, mailer, "https://fatherhood.school", hours(24))).toBe(0);
    expect(await remindAccountSetup(db, mailer, "https://fatherhood.school", hours(24 * 7))).toBe(2);
  });
});
