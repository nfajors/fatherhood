import { describe, expect, it } from "vitest";
import { becameView, creditWatchTime, isComplete, percentComplete, resumeAt } from "./progress";

const t0 = new Date("2026-10-17T12:00:00Z");
const after = (s: number) => new Date(t0.getTime() + s * 1000);

describe("creditWatchTime", () => {
  it("credits what was claimed when it fits in the real time that passed", () => {
    expect(creditWatchTime(15, t0, after(15))).toBe(15);
    expect(creditWatchTime(14.6, t0, after(15))).toBe(14);
  });

  it("never credits more than real time plus a little slack", () => {
    expect(creditWatchTime(600, t0, after(15))).toBe(20);
    expect(creditWatchTime(30, t0, after(0))).toBe(5);
  });

  it("caps a single heartbeat however long the gap", () => {
    expect(creditWatchTime(3000, t0, after(3600))).toBe(60);
  });

  it("ignores nonsense", () => {
    expect(creditWatchTime(-5, t0, after(15))).toBe(0);
    expect(creditWatchTime(Number.NaN, t0, after(15))).toBe(0);
    expect(creditWatchTime(10, after(30), t0)).toBe(5); // clock skew: only the slack
  });
});

describe("isComplete", () => {
  it("is complete at 90% or within the last 30 seconds, or when the video ended", () => {
    expect(isComplete(540, 600)).toBe(true);
    expect(isComplete(539, 600)).toBe(false);
    expect(isComplete(150, 180)).toBe(true);
    expect(isComplete(10, 600, true)).toBe(true);
    expect(isComplete(100, null)).toBe(false);
  });
});

describe("resumeAt", () => {
  it("backs up a few seconds, and starts over when finished or nearly so", () => {
    expect(resumeAt(125, 600, false)).toBe(122);
    expect(resumeAt(2, 600, false)).toBe(0);
    expect(resumeAt(125, 600, true)).toBe(0);
    expect(resumeAt(595, 600, false)).toBe(0);
    expect(resumeAt(null, 600, false)).toBe(0);
  });
});

describe("becameView and percentComplete", () => {
  it("counts a view once, when 30 seconds is crossed", () => {
    expect(becameView(20, 35)).toBe(true);
    expect(becameView(30, 45)).toBe(false);
    expect(becameView(0, 29)).toBe(false);
  });

  it("rounds percentages and handles empty courses", () => {
    expect(percentComplete(1, 3)).toBe(33);
    expect(percentComplete(0, 0)).toBe(0);
  });
});
