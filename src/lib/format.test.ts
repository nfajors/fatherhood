import { describe, expect, it } from "vitest";
import { formatClock, formatDuration } from "./format";

describe("formatDuration", () => {
  it("rounds to minutes and switches to hours", () => {
    expect(formatDuration(20)).toBe("1 min");
    expect(formatDuration(754)).toBe("13 min");
    expect(formatDuration(3600)).toBe("1 hr");
    expect(formatDuration(4830)).toBe("1 hr 21 min");
    expect(formatDuration(0)).toBe("");
    expect(formatDuration(null)).toBe("");
  });
});

describe("formatClock", () => {
  it("formats minutes and hours", () => {
    expect(formatClock(185)).toBe("3:05");
    expect(formatClock(3729)).toBe("1:02:09");
    expect(formatClock(-1)).toBe("0:00");
  });
});
