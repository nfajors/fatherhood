import { describe, expect, it } from "vitest";
import {
  allocatePool,
  engagementScoreMilli,
  isEligible,
  monthPeriod,
  payableBalances,
  poolAmountCents,
  quarterToDate,
  type CreatorInput,
} from "./pool";

describe("periods", () => {
  it("builds UTC month periods with an exclusive end, across year ends", () => {
    expect(monthPeriod(2026, 10)).toEqual({
      start: new Date("2026-10-01T00:00:00Z"),
      end: new Date("2026-11-01T00:00:00Z"),
    });
    expect(monthPeriod(2026, 12).end).toEqual(new Date("2027-01-01T00:00:00Z"));
  });

  it("starts the quarter window at the quarter start and stops at the period end", () => {
    expect(quarterToDate(monthPeriod(2026, 11))).toEqual({
      start: new Date("2026-10-01T00:00:00Z"),
      end: new Date("2026-12-01T00:00:00Z"),
    });
    expect(quarterToDate(monthPeriod(2026, 1)).start).toEqual(new Date("2026-01-01T00:00:00Z"));
    expect(quarterToDate(monthPeriod(2026, 6)).start).toEqual(new Date("2026-04-01T00:00:00Z"));
  });
});

describe("poolAmountCents", () => {
  it("is 25% of subscription revenue, truncated to whole cents", () => {
    expect(poolAmountCents(20_000_00)).toBe(5_000_00);
    expect(poolAmountCents(199_00)).toBe(49_75);
    expect(poolAmountCents(19_03)).toBe(4_75); // 475.75 truncates
    expect(poolAmountCents(0)).toBe(0);
  });
});

describe("engagementScoreMilli", () => {
  it("weights videos posted and views 50/50", () => {
    // 4 videos -> 20 points; 300 views -> 30 points; 0.5*20 + 0.5*30 = 25
    expect(engagementScoreMilli(4, 300)).toBe(25_000);
  });

  it("caps each component at 100 points (20 videos, 1,000 views)", () => {
    expect(engagementScoreMilli(20, 1_000)).toBe(100_000);
    expect(engagementScoreMilli(50, 1_000_000)).toBe(100_000);
    expect(engagementScoreMilli(40, 0)).toBe(50_000);
  });

  it("keeps fractional points exactly", () => {
    // 1 video -> 5 points; 13 views -> 1.3 points; 2.5 + 0.65 = 3.15
    expect(engagementScoreMilli(1, 13)).toBe(3_150);
  });
});

const creator = (creatorId: string, videosPostedInQuarter: number, ...views: number[]): CreatorInput => ({
  creatorId,
  videosPostedInQuarter,
  videos: views.map((qualifyingViews, i) => ({ videoId: `${creatorId}-v${i}`, qualifyingViews })),
});

describe("isEligible", () => {
  it("requires an approved video this quarter", () => {
    expect(isEligible(creator("a", 0, 500))).toBe(false);
    expect(isEligible(creator("a", 1, 500))).toBe(true);
  });

  it("requires at least one video with 10 or more counted views", () => {
    expect(isEligible(creator("a", 3, 9, 9, 9))).toBe(false);
    expect(isEligible(creator("a", 3, 9, 10))).toBe(true);
    expect(isEligible(creator("a", 3))).toBe(false);
  });
});

describe("allocatePool", () => {
  it("splits the pool by engagement score (worked example)", () => {
    // $20,000 revenue -> $5,000 pool.
    // A: 10 videos (50 pts), 2,000 views (capped 100) -> 0.5*50 + 0.5*100 = 75
    // B: 2 videos (10 pts), 500 views (50 pts) -> 30
    // C: 1 video (5 pts), 100 views (10 pts) -> 7.5
    // Total 112.5: A 66.67%, B 26.67%, C 6.67%
    const shares = allocatePool(5_000_00, [creator("A", 10, 2_000), creator("B", 2, 300, 200), creator("C", 1, 100)]);
    expect(shares.map((s) => [s.creatorId, s.engagementScoreMilli, s.amountCents, s.shareBps])).toEqual([
      ["A", 75_000, 3_333_34, 6_667],
      ["B", 30_000, 1_333_33, 2_667],
      ["C", 7_500, 333_33, 667],
    ]);
    // Each share rounds down by a third of a cent; the 1-cent remainder goes to the largest share.
    expect(shares.reduce((sum, s) => sum + s.amountCents, 0)).toBe(5_000_00);
  });

  it("only counts views from videos that reach the per-video threshold", () => {
    const [share] = allocatePool(100_00, [creator("A", 1, 50, 9, 3)]);
    expect(share).toMatchObject({ qualifyingViews: 50, amountCents: 100_00 });
    expect(share!.breakdown).toEqual([{ videoId: "A-v0", qualifyingViews: 50 }]);
  });

  it("excludes ineligible creators entirely", () => {
    const shares = allocatePool(100_00, [creator("A", 1, 20), creator("B", 0, 5_000), creator("C", 4, 9)]);
    expect(shares.map((s) => s.creatorId)).toEqual(["A"]);
    expect(shares[0]!.amountCents).toBe(100_00);
  });

  it("rounds equal halves up, then takes the extra cent back from the first largest share", () => {
    const shares = allocatePool(100_01, [creator("A", 1, 10), creator("B", 1, 10)]);
    expect(shares.map((s) => s.amountCents)).toEqual([50_00, 50_01]);
  });

  it("takes back a rounding overshoot from the largest share", () => {
    // Three equal creators, 2 cents: each rounds 0.667 up to 1 (3 total), largest gives one back.
    const shares = allocatePool(2, [creator("A", 1, 10), creator("B", 1, 10), creator("C", 1, 10)]);
    expect(shares.map((s) => s.amountCents)).toEqual([0, 1, 1]);
  });

  it("allocates nothing from an empty pool and nothing to nobody", () => {
    expect(allocatePool(0, [creator("A", 1, 10)])).toEqual([
      expect.objectContaining({ creatorId: "A", amountCents: 0, shareBps: 0 }),
    ]);
    expect(allocatePool(100_00, [])).toEqual([]);
  });

  it("always allocates exactly the pool", () => {
    const creators = Array.from({ length: 37 }, (_, i) => creator(`c${i}`, (i % 7) + 1, 10 + i * 13, i * 3));
    for (const pool of [1, 99, 12_345, 1_000_000_07]) {
      expect(allocatePool(pool, creators).reduce((sum, s) => sum + s.amountCents, 0)).toBe(pool);
    }
  });
});

describe("payableBalances", () => {
  it("pays balances of $20 or more and carries smaller ones forward", () => {
    const payable = payableBalances(
      new Map([
        ["a", 20_00],
        ["b", 19_99],
        ["c", 512_40],
      ]),
    );
    expect([...payable]).toEqual([
      ["a", 20_00],
      ["c", 512_40],
    ]);
  });
});
