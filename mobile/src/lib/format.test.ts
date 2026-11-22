import { describe, expect, it } from "vitest";
import { compareVersions, formatBytes, formatClock, formatDuration } from "./format";

describe("format", () => {
  it("formats lengths, positions and sizes", () => {
    expect(formatDuration(300)).toBe("5 min");
    expect(formatDuration(20)).toBe("1 min");
    expect(formatDuration(3900)).toBe("1 h 05 min");
    expect(formatDuration(null)).toBe("");
    expect(formatClock(65)).toBe("1:05");
    expect(formatClock(3729)).toBe("1:02:09");
    expect(formatBytes(150 * 1024 * 1024)).toBe("150 MB");
    expect(formatBytes(2.5 * 1024 * 1024 * 1024)).toBe("2.5 GB");
  });

  it("compares app versions", () => {
    expect(compareVersions("1.0.0", "1.0.1")).toBeLessThan(0);
    expect(compareVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
  });
});
