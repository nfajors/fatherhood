import { describe, expect, it } from "vitest";
import { generateGiftCode, normalizeGiftCode } from "./codes";

describe("generateGiftCode", () => {
  it("produces FATHER-XXXX-XXXX from the unambiguous alphabet", () => {
    for (let i = 0; i < 200; i++) {
      expect(generateGiftCode()).toMatch(/^FATHER-[2-9ABCDEFGHJKMNPQRSTVWXYZ]{4}-[2-9ABCDEFGHJKMNPQRSTVWXYZ]{4}$/);
    }
  });

  it("uses the random source for every character", () => {
    let n = 0;
    expect(generateGiftCode(() => n++ % 30)).toBe("FATHER-2345-6789");
  });

  it("does not repeat in practice", () => {
    const codes = new Set(Array.from({ length: 5_000 }, () => generateGiftCode()));
    expect(codes.size).toBe(5_000);
  });
});

describe("normalizeGiftCode", () => {
  it("accepts the code however it was typed", () => {
    for (const typed of ["FATHER-ABCD-2345", "father-abcd-2345", " father abcd 2345 ", "ABCD2345", "abcd-2345", "FATHERABCD2345"]) {
      expect(normalizeGiftCode(typed)).toBe("FATHER-ABCD-2345");
    }
  });

  it("rejects wrong lengths and look-alike characters instead of guessing", () => {
    expect(normalizeGiftCode("FATHER-ABCD-234")).toBeNull();
    expect(normalizeGiftCode("FATHER-ABCD-23456")).toBeNull();
    expect(normalizeGiftCode("FATHER-ABCD-2340")).toBeNull(); // 0
    expect(normalizeGiftCode("FATHER-OBCD-2345")).toBeNull(); // O
    expect(normalizeGiftCode("FATHER-IBCD-2345")).toBeNull(); // I
    expect(normalizeGiftCode("")).toBeNull();
  });
});
