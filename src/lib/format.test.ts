import { describe, expect, it } from "vitest";
import { formatClock, formatCount, formatDuration, formatMoney, formatWatchTime } from "./format";

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

describe("formatMoney, formatWatchTime, formatCount", () => {
  it("formats cents, watch time and compact counts", () => {
    expect(formatMoney(123_456)).toBe("$1,234.56");
    expect(formatMoney(0)).toBe("$0.00");
    expect(formatWatchTime(0)).toBe("0 min");
    expect(formatWatchTime(12_000)).toBe("3 hr 20 min");
    expect(formatCount(980)).toBe("980");
    expect(formatCount(1284)).toBe("1.3K");
    expect(formatCount(4_200_000)).toBe("4.2M");
  });
});
