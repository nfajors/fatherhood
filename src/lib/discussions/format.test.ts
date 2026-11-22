import { describe, expect, it } from "vitest";
import { timeAgo } from "./format";

describe("timeAgo", () => {
  const now = new Date("2026-11-22T15:00:00Z");
  it("reads like a feed", () => {
    expect(timeAgo(new Date("2026-11-22T14:59:30Z"), now)).toBe("just now");
    expect(timeAgo(new Date("2026-11-22T14:55:00Z"), now)).toBe("5m");
    expect(timeAgo(new Date("2026-11-22T12:00:00Z"), now)).toBe("3h");
    expect(timeAgo(new Date("2026-11-20T15:00:00Z"), now)).toBe("2d");
    expect(timeAgo(new Date("2026-10-01T15:00:00Z"), now)).toBe("Oct 1");
    expect(timeAgo(new Date("2025-10-01T15:00:00Z"), now)).toBe("Oct 1, 2025");
  });
});
