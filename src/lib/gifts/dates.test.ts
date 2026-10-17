import { describe, expect, it } from "vitest";
import { addMonths } from "./service";

describe("addMonths", () => {
  it("adds calendar months in UTC", () => {
    expect(addMonths(new Date("2026-10-17T15:30:00Z"), 12)).toEqual(new Date("2027-10-17T15:30:00Z"));
    expect(addMonths(new Date("2026-10-17T15:30:00Z"), 1)).toEqual(new Date("2026-11-17T15:30:00Z"));
    expect(addMonths(new Date("2026-12-05T00:00:00Z"), 1)).toEqual(new Date("2027-01-05T00:00:00Z"));
  });

  it("clamps to the end of shorter months", () => {
    expect(addMonths(new Date("2027-01-31T12:00:00Z"), 1)).toEqual(new Date("2027-02-28T12:00:00Z"));
    expect(addMonths(new Date("2028-01-31T12:00:00Z"), 1)).toEqual(new Date("2028-02-29T12:00:00Z"));
    expect(addMonths(new Date("2028-02-29T12:00:00Z"), 12)).toEqual(new Date("2029-02-28T12:00:00Z"));
  });

  it("does not mutate its input", () => {
    const start = new Date("2026-10-17T00:00:00Z");
    addMonths(start, 3);
    expect(start).toEqual(new Date("2026-10-17T00:00:00Z"));
  });
});
