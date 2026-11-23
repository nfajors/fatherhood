/** Reset-link limits against a real Postgres. Runs only with TEST_DATABASE_URL (tables are truncated). */
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { hasPassword, RESET_POLICY, shouldSendReset } from "./password-reset";

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-23T12:00:00Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

describe.skipIf(!url)("password reset (Postgres)", () => {
  let client: postgres.Sql;
  let db: Database;

  beforeAll(async () => {
    client = postgres(url!, { max: 2, onnotice: () => {} });
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: "drizzle" });
  });
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await db.execute(sql`truncate verification, account, "user" cascade`);
    await db.insert(schema.user).values([
      { id: "pw", name: "Marcus", email: "marcus@test.dev" },
      { id: "google", name: "Sam", email: "sam@test.dev" },
    ]);
    await db.insert(schema.account).values([
      { id: "a1", accountId: "pw", providerId: "credential", userId: "pw", password: "hash" },
      { id: "a2", accountId: "g-123", providerId: "google", userId: "google" },
    ]);
  });

  const link = (userId: string, createdAt: Date, i: number) =>
    db.insert(schema.verification).values({ id: `v${userId}${i}`, identifier: `reset-password:t${userId}${i}`, value: userId, expiresAt: new Date(createdAt.getTime() + 3_600_000), createdAt });

  it("knows who has a password and who only signs in with Google", async () => {
    expect(await hasPassword(db, "pw")).toBe(true);
    expect(await hasPassword(db, "google")).toBe(false);
  });

  it(`emails at most ${RESET_POLICY.maxLinks} links per account in ${RESET_POLICY.windowMinutes} minutes`, async () => {
    for (let i = 0; i < RESET_POLICY.maxLinks; i++) await link("pw", minutesAgo(i), i);
    expect(await shouldSendReset(db, "pw", NOW)).toBe(true);
    await link("pw", NOW, 9);
    expect(await shouldSendReset(db, "pw", NOW)).toBe(false);
    // Other people's links and older links don't count.
    expect(await shouldSendReset(db, "google", NOW)).toBe(true);
    expect(await shouldSendReset(db, "pw", new Date(NOW.getTime() + (RESET_POLICY.windowMinutes + 1) * 60_000))).toBe(true);
    // Neither do other kinds of verification.
    await db.insert(schema.verification).values({ id: "other", identifier: "email-verification:x", value: "google", expiresAt: NOW, createdAt: NOW });
    expect(await shouldSendReset(db, "google", NOW)).toBe(true);
  });
});
