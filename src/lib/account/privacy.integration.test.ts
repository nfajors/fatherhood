/**
 * Data export and account deletion against a real Postgres. Runs only when
 * TEST_DATABASE_URL points at a disposable database (tables are truncated).
 */
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { AccountError, deleteAccount, exportAccount } from "./privacy";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("privacy (Postgres)", () => {
  let client: postgres.Sql;
  let db: Database;
  const cancelled: string[] = [];
  const canceller = { cancel: async (id: string) => void cancelled.push(id) };

  beforeAll(async () => {
    client = postgres(url!, { max: 4, onnotice: () => {} });
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: "drizzle" });
  });

  afterAll(async () => {
    await client?.end();
  });

  beforeEach(async () => {
    cancelled.length = 0;
    await db.execute(sql`truncate coach_conversations, coach_profiles, posts, follows, subscriptions, revenue_ledger, videos, comments, "user" cascade`);
    await db.insert(schema.user).values([
      { id: "dad", name: "Marcus Lee", email: "marcus@test.dev" },
      { id: "other", name: "Sam Cole", email: "sam@test.dev" },
      { id: "fellow", name: "James Hill", email: "james@test.dev", role: "creator" },
    ]);
    await db.insert(schema.subscriptions).values([
      { userId: "dad", plan: "monthly", status: "active", stripeSubscriptionId: "sub_dad", currentPeriodEnd: new Date("2027-01-01"), currency: "gbp" },
      { userId: "dad", plan: "monthly", status: "canceled", stripeSubscriptionId: "sub_old", currentPeriodEnd: new Date("2026-01-01") },
      { userId: "other", plan: "monthly", status: "active", stripeSubscriptionId: "sub_other", currentPeriodEnd: new Date("2027-01-01") },
    ]);
    await db.insert(schema.coachProfiles).values({ userId: "dad", stage: "teens", children: "a son, 14", goals: "Talk more" });
    const [conv] = await db.insert(schema.coachConversations).values({ userId: "dad", title: "My son" }).returning();
    await db.insert(schema.coachMessages).values([
      { conversationId: conv!.id, userId: "dad", role: "user", content: "He won't talk to me." },
      { conversationId: conv!.id, userId: "dad", role: "assistant", content: "Try car rides.", model: "m" },
    ]);
    const [mine] = await db.insert(schema.posts).values({ authorId: "dad", body: "Anyone else?", status: "visible" }).returning();
    await db.insert(schema.posts).values({ authorId: "other", body: "Not mine", status: "visible" });
    await db.insert(schema.follows).values({ followerId: "dad", followeeId: "other" });
    await db.insert(schema.revenueLedger).values({ kind: "subscription_invoice", stripeObjectId: "in_1", userId: "dad", amountCents: 1_900, occurredAt: new Date() });
    expect(mine).toBeTruthy();
  });

  it("exports the person's own data, and nobody else's", async () => {
    const data = await exportAccount(db, "dad");
    expect(data.account).toMatchObject({ id: "dad", email: "marcus@test.dev" });
    expect(data.memberships.map((m) => [m.status, m.currency])).toEqual(expect.arrayContaining([["active", "gbp"], ["canceled", "usd"]]));
    expect(data.coach.profile).toEqual({ stage: "teens", children: "a son, 14", goals: "Talk more" });
    expect(data.coach.conversations[0]!.messages.map((m) => m.content)).toEqual(["He won't talk to me.", "Try car rides."]);
    expect(data.discussions.posts.map((p) => p.body)).toEqual(["Anyone else?"]);
    expect(data.discussions.following).toEqual([expect.objectContaining({ followeeId: "other" })]);
    expect(JSON.stringify(data)).not.toContain("Not mine");
    expect(JSON.stringify(data)).not.toContain("sub_other");
  });

  it("needs DELETE typed, cancels billing, then removes the account and what's theirs", async () => {
    await expect(deleteAccount(db, canceller, { userId: "dad", confirmation: "yes" })).rejects.toMatchObject({ reason: "confirm" });
    await deleteAccount(db, canceller, { userId: "dad", confirmation: "delete" });
    expect(cancelled).toEqual(["sub_dad"]);
    expect(await db.query.user.findFirst({ where: eq(schema.user.id, "dad") })).toBeUndefined();
    expect(await db.$count(schema.coachMessages)).toBe(0);
    expect(await db.$count(schema.posts)).toBe(1);
    expect(await db.$count(schema.subscriptions, eq(schema.subscriptions.userId, "other"))).toBe(1);
    // The payment record stays, without the person.
    expect(await db.select({ userId: schema.revenueLedger.userId, amount: schema.revenueLedger.amountCents }).from(schema.revenueLedger)).toEqual([{ userId: null, amount: 1_900 }]);
  });

  it("asks Fellows with videos to contact us, and changes nothing", async () => {
    await db.insert(schema.videos).values({ type: "community", status: "approved", creatorId: "fellow", title: "Story", requireSignedUrls: false });
    await expect(deleteAccount(db, canceller, { userId: "fellow", confirmation: "DELETE" })).rejects.toBeInstanceOf(AccountError);
    expect(await db.query.user.findFirst({ where: eq(schema.user.id, "fellow") })).toBeTruthy();
    expect(cancelled).toEqual([]);
  });
});
