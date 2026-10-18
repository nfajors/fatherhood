import { describe, expect, it } from "vitest";
import { MARK_END, MARK_START, normalizeQuery, prefixQuery, snippetParts, usesSearchSyntax } from "./search";

describe("normalizeQuery", () => {
  it("collapses whitespace and caps length", () => {
    expect(normalizeQuery("  night   shifts \n")).toBe("night shifts");
    expect(normalizeQuery(null)).toBe("");
    expect(normalizeQuery("x".repeat(300))).toHaveLength(200);
  });
});

describe("prefixQuery", () => {
  it("matches every word as a prefix, trimming long fragments toward a stem", () => {
    expect(prefixQuery("coachi")).toBe("coac:*");
    expect(prefixQuery("parent")).toBe("pare:*");
    expect(prefixQuery("Dad bedtim")).toBe("dad:* & bedt:*");
    expect(prefixQuery("apologizin")).toBe("apolog:*");
  });

  it("drops punctuation and query syntax, and gives up on nothing usable", () => {
    expect(prefixQuery("it's (dad) & | !")).toBe("it:* & s:* & dad:*");
    expect(prefixQuery("!!! ---")).toBeNull();
  });
});

describe("usesSearchSyntax", () => {
  it("spots quotes, or and exclusions, not hyphenated words", () => {
    expect(usesSearchSyntax('"night shift"')).toBe(true);
    expect(usesSearchSyntax("bedtime -nights")).toBe(true);
    expect(usesSearchSyntax("teens or toddlers")).toBe(true);
    expect(usesSearchSyntax("co-parenting tips")).toBe(false);
    expect(usesSearchSyntax("orchard")).toBe(false);
  });
});

describe("snippetParts", () => {
  it("splits highlighted words out of a headline", () => {
    expect(snippetParts(`I work ${MARK_START}nights${MARK_END}, so ${MARK_START}bedtime${MARK_END} is late`)).toEqual([
      { text: "I work ", mark: false },
      { text: "nights", mark: true },
      { text: ", so ", mark: false },
      { text: "bedtime", mark: true },
      { text: " is late", mark: false },
    ]);
    expect(snippetParts(null)).toEqual([]);
    expect(snippetParts("<b>plain</b>")).toEqual([{ text: "<b>plain</b>", mark: false }]);
  });
});
