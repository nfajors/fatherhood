import { describe, expect, it } from "vitest";
import { decide, overallRisk, priorityRank, reviewDueAt, slaState } from "./decide";
import { RISK_CATEGORIES, type RiskCategory } from "./policy";
import type { RiskLevel, ScreenResult } from "./screen";

const levels = (overrides: Partial<Record<RiskCategory, RiskLevel>> = {}) =>
  ({ ...Object.fromEntries(Object.keys(RISK_CATEGORIES).map((k) => [k, "none"])), ...overrides }) as Record<RiskCategory, RiskLevel>;

const clean = (overrides: Partial<Extract<ScreenResult, { kind: "screened" }>> = {}): ScreenResult => ({
  kind: "screened",
  model: "m",
  hadTranscript: true,
  frameCount: 4,
  summary: "A father on bedtime routines.",
  categories: levels(),
  concerns: [],
  relevance: 92,
  quality_notes: [],
  recommendation: "approve",
  recommendation_reason: "Clean and on topic.",
  ...overrides,
});

describe("overallRisk", () => {
  it("is the worst category; none and low both count as low", () => {
    expect(overallRisk(clean({ categories: levels({ sexual: "low" }) }))).toBe("low");
    expect(overallRisk(clean({ categories: levels({ spam_or_promotion: "medium" }) }))).toBe("medium");
    expect(overallRisk(clean({ categories: levels({ violence: "medium", child_safety: "high" }) }))).toBe("high");
  });

  it("treats a declined screen as high risk", () => {
    expect(overallRisk({ kind: "declined", model: "m", category: "cyber", hadTranscript: true, frameCount: 4 })).toBe("high");
  });
});

describe("decide", () => {
  const trusted = { type: "community" as const, creatorHasHumanApproval: true };

  it("auto-approves a clean, relevant, transcribed Community video from a trusted creator", () => {
    expect(decide({ ...trusted, result: clean() })).toEqual({ autoApprove: true, risk: "low", priority: "normal", reasons: [] });
  });

  it.each([
    ["professional videos", { type: "professional" as const }, {}, /Professional videos/],
    ["a creator's first video", { creatorHasHumanApproval: false }, {}, /first video/],
    ["a resubmission after a change request", { reviewerRequestedChanges: true }, {}, /asked for changes/],
    ["no transcript", {}, { hadTranscript: false }, /No transcript/],
    ["low relevance", {}, { relevance: 79 }, /Relevance 79 is below 80/],
    ["a review recommendation", {}, { recommendation: "review" as const }, /recommends "review"/],
    ["medium risk", {}, { categories: levels({ unqualified_medical_or_legal_advice: "medium" }) }, /medium risk/],
  ])("never auto-approves %s", (_name, inputOverrides, resultOverrides, reason) => {
    const decision = decide({ ...trusted, ...inputOverrides, result: clean(resultOverrides) });
    expect(decision.autoApprove).toBe(false);
    expect(decision.reasons.join(" ")).toMatch(reason);
  });

  it("prioritizes by risk", () => {
    expect(decide({ ...trusted, result: clean({ categories: levels({ hate_or_harassment: "high" }) }) }).priority).toBe("urgent");
    expect(decide({ ...trusted, result: clean({ categories: levels({ spam_or_promotion: "medium" }) }) }).priority).toBe("high");
    expect(decide({ ...trusted, result: clean({ recommendation: "reject" }) }).priority).toBe("high");
    expect(decide({ ...trusted, result: { kind: "declined", model: "m", category: null, hadTranscript: true, frameCount: 4 } })).toMatchObject({
      autoApprove: false,
      priority: "urgent",
    });
  });
});

describe("deadlines", () => {
  const start = new Date("2026-10-17T12:00:00Z");

  it("gives Community videos 48 hours and professional 120", () => {
    expect(reviewDueAt("community", start)).toEqual(new Date("2026-10-19T12:00:00Z"));
    expect(reviewDueAt("professional", start)).toEqual(new Date("2026-10-22T12:00:00Z"));
  });

  it("flags due-soon within 24 hours and overdue after the deadline", () => {
    const due = new Date("2026-10-19T12:00:00Z");
    expect(slaState(due, new Date("2026-10-18T11:00:00Z"))).toBe("on_track");
    expect(slaState(due, new Date("2026-10-18T13:00:00Z"))).toBe("due_soon");
    expect(slaState(due, new Date("2026-10-19T12:00:01Z"))).toBe("overdue");
    expect(slaState(null)).toBe("on_track");
  });

  it("ranks queue priority", () => {
    expect([priorityRank("high", "approve"), priorityRank("medium", null), priorityRank("low", "reject"), priorityRank("low", "approve"), priorityRank(null, null)]).toEqual([0, 1, 1, 2, 2]);
  });
});
