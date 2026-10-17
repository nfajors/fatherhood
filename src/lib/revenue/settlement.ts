/**
 * Monthly creator-pool settlement: loads the period's revenue and engagement,
 * applies the Winning pool policy (pool.ts) and records shares and payouts.
 * Payout records start as "pending"; sending money (Stripe Connect) is a later step.
 */
import { and, eq, gte, isNull, lt, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import {
  creatorPayouts,
  poolCalculations,
  poolShares,
  revenueLedger,
  videos,
  watchSessions,
} from "@/lib/db/schema";
import { allocatePool, payableBalances, poolAmountCents, quarterToDate, type CreatorInput, type CreatorShare, type Period } from "./pool";
import { REVENUE_POLICY } from "./policy";

export type SettlementResult = {
  calculationId: string;
  period: Period;
  subscriptionRevenueCents: number;
  poolCents: number;
  shares: { creatorId: string; amountCents: number }[];
  payouts: { creatorId: string; amountCents: number }[];
  alreadySettled: boolean;
};

export class SettlementError extends Error {}

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Gather per-creator inputs for the period. */
async function loadCreatorInputs(db: Database | Transaction, period: Period): Promise<CreatorInput[]> {
  const quarter = quarterToDate(period);
  const postedAt = sql`coalesce(${videos.publishedAt}, ${videos.createdAt})`;

  const posted = await db
    .select({ creatorId: videos.creatorId, count: sql<number>`count(*)::int` })
    .from(videos)
    // Raw expressions get no column type, so pass the bounds as ISO timestamps.
    .where(
      and(
        eq(videos.status, "approved"),
        sql`${postedAt} >= ${quarter.start.toISOString()}::timestamptz`,
        sql`${postedAt} < ${quarter.end.toISOString()}::timestamptz`,
      ),
    )
    .groupBy(videos.creatorId);

  const views = await db
    .select({
      videoId: videos.id,
      creatorId: videos.creatorId,
      qualifyingViews: sql<number>`count(*)::int`,
    })
    .from(watchSessions)
    .innerJoin(videos, eq(watchSessions.videoId, videos.id))
    .where(
      and(
        eq(videos.status, "approved"),
        gte(watchSessions.startedAt, period.start),
        lt(watchSessions.startedAt, period.end),
        gte(watchSessions.secondsWatched, REVENUE_POLICY.minWatchSecondsPerView),
      ),
    )
    .groupBy(videos.id, videos.creatorId);

  const byCreator = new Map<string, CreatorInput>();
  const entry = (creatorId: string) => {
    let c = byCreator.get(creatorId);
    if (!c) {
      c = { creatorId, videosPostedInQuarter: 0, videos: [] };
      byCreator.set(creatorId, c);
    }
    return c;
  };
  for (const row of posted) entry(row.creatorId).videosPostedInQuarter = row.count;
  for (const row of views) entry(row.creatorId).videos.push({ videoId: row.videoId, qualifyingViews: row.qualifyingViews });
  return [...byCreator.values()].sort((a, b) => a.creatorId.localeCompare(b.creatorId));
}

async function periodRevenueCents(db: Database | Transaction, period: Period): Promise<number> {
  const [revenue] = await db
    .select({ cents: sql<number>`coalesce(sum(${revenueLedger.amountCents}), 0)::int` })
    .from(revenueLedger)
    .where(and(gte(revenueLedger.occurredAt, period.start), lt(revenueLedger.occurredAt, period.end)));
  return revenue?.cents ?? 0;
}

/**
 * What settling the period would pay, without recording anything: the
 * in-month estimate creators see. Uses the same inputs and math as settlePeriod.
 */
export async function estimatePeriod(db: Database, period: Period): Promise<{ inputs: CreatorInput[]; shares: CreatorShare[] }> {
  const inputs = await loadCreatorInputs(db, period);
  return { inputs, shares: allocatePool(poolAmountCents(await periodRevenueCents(db, period)), inputs) };
}

/**
 * Settle one period. Re-running a completed period returns the stored result
 * unless `force` is set; forcing is refused once any share has been paid out.
 */
export async function settlePeriod(db: Database, period: Period, options: { force?: boolean } = {}): Promise<SettlementResult> {
  return db.transaction(async (tx) => {
    const existing = await tx.query.poolCalculations.findFirst({
      where: and(eq(poolCalculations.periodStart, period.start), eq(poolCalculations.periodEnd, period.end)),
    });

    if (existing?.status === "completed" && !options.force) {
      const shares = await tx
        .select({ creatorId: poolShares.creatorId, amountCents: poolShares.amountCents })
        .from(poolShares)
        .where(eq(poolShares.calculationId, existing.id));
      return {
        calculationId: existing.id,
        period,
        subscriptionRevenueCents: existing.subscriptionRevenueCents,
        poolCents: existing.poolCents,
        shares,
        payouts: [],
        alreadySettled: true,
      };
    }

    if (existing) {
      const paid = await tx
        .select({ id: poolShares.id })
        .from(poolShares)
        .where(and(eq(poolShares.calculationId, existing.id), sql`${poolShares.payoutId} is not null`))
        .limit(1);
      if (paid.length > 0) throw new SettlementError("This period has shares included in payouts and cannot be recalculated.");
      await tx.delete(poolCalculations).where(eq(poolCalculations.id, existing.id));
    }

    const subscriptionRevenueCents = await periodRevenueCents(tx, period);
    const poolCents = poolAmountCents(subscriptionRevenueCents);
    const shares = allocatePool(poolCents, await loadCreatorInputs(tx, period));

    const [calculation] = await tx
      .insert(poolCalculations)
      .values({
        periodStart: period.start,
        periodEnd: period.end,
        status: "completed",
        algorithmVersion: REVENUE_POLICY.algorithmVersion,
        subscriptionRevenueCents,
        poolShareBps: REVENUE_POLICY.poolShareBps,
        poolCents,
        eligibleCreators: shares.length,
        completedAt: new Date(),
      })
      .returning({ id: poolCalculations.id });
    if (!calculation) throw new SettlementError("Could not record the pool calculation.");

    if (shares.length > 0) {
      await tx.insert(poolShares).values(
        shares.map((s) => ({
          calculationId: calculation.id,
          creatorId: s.creatorId,
          videosPostedInQuarter: s.videosPostedInQuarter,
          qualifyingViews: s.qualifyingViews,
          engagementScoreMilli: s.engagementScoreMilli,
          shareBps: s.shareBps,
          amountCents: s.amountCents,
          breakdown: s.breakdown,
        })),
      );
    }

    // Pay out every creator whose unpaid balance (this and earlier periods) reaches the minimum.
    const unpaid = await tx
      .select({
        creatorId: poolShares.creatorId,
        cents: sql<number>`sum(${poolShares.amountCents})::int`,
        since: sql<Date>`min(${poolCalculations.periodStart})`,
      })
      .from(poolShares)
      .innerJoin(poolCalculations, eq(poolShares.calculationId, poolCalculations.id))
      .where(isNull(poolShares.payoutId))
      .groupBy(poolShares.creatorId);
    const payable = payableBalances(new Map(unpaid.map((u) => [u.creatorId, u.cents])));

    const payouts: SettlementResult["payouts"] = [];
    for (const row of unpaid) {
      const amountCents = payable.get(row.creatorId);
      if (amountCents === undefined) continue;
      const [payout] = await tx
        .insert(creatorPayouts)
        .values({
          creatorId: row.creatorId,
          periodStart: new Date(row.since),
          periodEnd: period.end,
          amountCents,
          status: "pending",
        })
        .returning({ id: creatorPayouts.id });
      if (!payout) throw new SettlementError("Could not record a payout.");
      await tx
        .update(poolShares)
        .set({ payoutId: payout.id })
        .where(and(eq(poolShares.creatorId, row.creatorId), isNull(poolShares.payoutId)));
      payouts.push({ creatorId: row.creatorId, amountCents });
    }

    return {
      calculationId: calculation.id,
      period,
      subscriptionRevenueCents,
      poolCents,
      shares: shares.map((s) => ({ creatorId: s.creatorId, amountCents: s.amountCents })),
      payouts,
      alreadySettled: false,
    };
  });
}
