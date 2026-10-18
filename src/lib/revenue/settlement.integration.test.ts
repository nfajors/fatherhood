/**
 * Settlement against a real Postgres. Runs only when TEST_DATABASE_URL points at
 * a disposable database (tables are truncated):
 *
 *   TEST_DATABASE_URL=postgres://... npm test
 */
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { monthPeriod } from "./pool";
import { SettlementError, settlePeriod } from "./settlement";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("settlePeriod (Postgres)", () => {
  let client: postgres.Sql;
  let db: Database;

  beforeAll(async () => {
    client = postgres(url!, { max: 1, onnotice: () => {} });
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: "drizzle" });
  });

  afterAll(async () => {
    await client?.end();
  });

  beforeEach(async () => {
    await db.execute(sql`truncate pool_shares, pool_calculations, creator_payouts, payout_accounts, revenue_ledger,
      watch_sessions, video_reviews, videos, "user" cascade`);
    await db.insert(schema.user).values(
      ["A", "B", "C", "D"].map((k) => ({ id: `cr_${k}`, name: `Creator ${k}`, email: `${k}@test.dev`, role: "creator" as const })),
    );
  });

  async function revenue(id: string, cents: number, at: string) {
    await db.insert(schema.revenueLedger).values({ kind: "subscription_invoice", stripeObjectId: id, amountCents: cents, occurredAt: new Date(at) });
  }

  async function video(id: string, creatorId: string, publishedAt: string) {
    await db.insert(schema.videos).values({
      id,
      type: "community",
      status: "approved",
      creatorId,
      title: id,
      requireSignedUrls: false,
      publishedAt: new Date(publishedAt),
    });
  }

  async function views(videoId: string, count: number, secondsWatched: number, at: string) {
    await db.execute(sql`insert into watch_sessions (video_id, seconds_watched, started_at)
      select ${videoId}::uuid, ${secondsWatched}, ${at}::timestamptz from generate_series(1, ${count})`);
  }

  const uuid = (prefix: string, n: number) => `${prefix.repeat(8)}-0000-4000-8000-${String(n).padStart(12, "0")}`;

  it("settles the worked example from the development plan", async () => {
    for (let i = 1; i <= 100; i++) await revenue(`in_${i}`, 200_00, "2026-09-10");
    await revenue("in_aug", 999_99, "2026-08-31T23:59:59Z"); // previous month: excluded

    for (let i = 1; i <= 10; i++) await video(uuid("a", i), "cr_A", "2026-07-15");
    await video(uuid("b", 1), "cr_B", "2026-09-01");
    await video(uuid("b", 2), "cr_B", "2026-09-02");
    await video(uuid("c", 1), "cr_C", "2026-08-01");
    await video(uuid("d", 1), "cr_D", "2026-06-30"); // posted last quarter: D is ineligible

    await views(uuid("a", 1), 2_000, 120, "2026-09-05");
    await views(uuid("b", 1), 300, 45, "2026-09-05");
    await views(uuid("b", 2), 200, 30, "2026-09-05");
    await views(uuid("c", 1), 100, 60, "2026-09-05");
    await views(uuid("d", 1), 5_000, 60, "2026-09-05");
    await views(uuid("c", 1), 500, 29, "2026-09-05"); // under 30 seconds: not views
    await views(uuid("c", 1), 500, 60, "2026-10-01"); // next month

    const result = await settlePeriod(db, monthPeriod(2026, 9));

    expect(result.subscriptionRevenueCents).toBe(20_000_00);
    expect(result.poolCents).toBe(5_000_00);
    expect(result.shares).toEqual([
      { creatorId: "cr_A", amountCents: 3_333_34 },
      { creatorId: "cr_B", amountCents: 1_333_33 },
      { creatorId: "cr_C", amountCents: 333_33 },
    ]);
    expect(result.payouts).toEqual(result.shares);

    const rerun = await settlePeriod(db, monthPeriod(2026, 9));
    expect(rerun).toMatchObject({ alreadySettled: true, calculationId: result.calculationId, payouts: [] });

    // Untried payouts are withdrawn and recreated when the month is recalculated...
    const recalculated = await settlePeriod(db, monthPeriod(2026, 9), { force: true });
    expect(recalculated.payouts).toEqual(result.shares);
    expect(await db.$count(schema.creatorPayouts)).toBe(3);
    // ...but once any transfer has been tried, the month is final.
    await db.update(schema.creatorPayouts).set({ attempts: 1, status: "failed" }).where(sql`${schema.creatorPayouts.creatorId} = 'cr_B'`);
    await expect(settlePeriod(db, monthPeriod(2026, 9), { force: true })).rejects.toThrowError(SettlementError);
    expect(await db.$count(schema.creatorPayouts)).toBe(3);
  });

  it("carries balances under $20 forward until they reach it", async () => {
    await video(uuid("c", 1), "cr_C", "2026-10-02");
    await revenue("in_oct", 40_00, "2026-10-05");
    await views(uuid("c", 1), 10, 60, "2026-10-05");
    await revenue("in_nov", 60_00, "2026-11-05");
    await views(uuid("c", 1), 10, 60, "2026-11-05");

    const october = await settlePeriod(db, monthPeriod(2026, 10));
    expect(october.shares).toEqual([{ creatorId: "cr_C", amountCents: 10_00 }]);
    expect(october.payouts).toEqual([]);

    const november = await settlePeriod(db, monthPeriod(2026, 11));
    expect(november.payouts).toEqual([{ creatorId: "cr_C", amountCents: 25_00 }]);

    const [payout] = await db.select().from(schema.creatorPayouts);
    expect(payout).toMatchObject({ amountCents: 25_00, status: "pending", periodStart: new Date("2026-10-01T00:00:00Z") });
  });

  it("recalculates an unpaid period when forced", async () => {
    await video(uuid("c", 1), "cr_C", "2026-12-01");
    await views(uuid("c", 1), 10, 60, "2026-12-05");
    await revenue("in_dec", 20_00, "2026-12-05");
    expect((await settlePeriod(db, monthPeriod(2026, 12))).poolCents).toBe(5_00);

    await revenue("in_dec_late", 20_00, "2026-12-06");
    const forced = await settlePeriod(db, monthPeriod(2026, 12), { force: true });
    expect(forced).toMatchObject({ poolCents: 10_00, alreadySettled: false });
    expect(await db.$count(schema.poolCalculations)).toBe(1);
  });

  it("records an empty settlement when nobody is eligible", async () => {
    await revenue("in_jan", 100_00, "2027-01-05");
    const result = await settlePeriod(db, monthPeriod(2027, 1));
    expect(result).toMatchObject({ poolCents: 25_00, shares: [], payouts: [] });
  });
});
