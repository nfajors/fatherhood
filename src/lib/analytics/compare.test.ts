import { describe, expect, it } from "vitest";
import { compare, percent } from "./compare";

describe("compare", () => {
  it("describes a rise and a fall, and whether that's good", () => {
    expect(compare(112, 100)).toEqual({ direction: "up", text: "+12%", tone: "good" });
    expect(compare(60, 100)).toEqual({ direction: "down", text: "−40%", tone: "bad" });
    expect(compare(12, 10, false)).toEqual({ direction: "up", text: "+20%", tone: "bad" });
    expect(compare(1001, 1000)).toMatchObject({ text: "+<1%" });
    expect(compare(950, 100)).toMatchObject({ text: "+850%" });
    expect(compare(1495, 1)).toMatchObject({ text: "1,495×", tone: "good" });
  });

  it("handles nothing before, and no change", () => {
    expect(compare(5, 0)).toEqual({ direction: "up", text: "New", tone: "good" });
    expect(compare(0, 0)).toEqual({ direction: "flat", text: "No change", tone: "neutral" });
  });
});

describe("percent", () => {
  it("rounds, and says so when there is no base", () => {
    expect(percent(0.3333)).toBe("33%");
    expect(percent(0.001)).toBe("<1%");
    expect(percent(0)).toBe("0%");
    expect(percent(null)).toBe("–");
  });
});
