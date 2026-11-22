import { describe, expect, it } from "vitest";
import { countryFromLanguages, formatAmount, formatDate, formatPrice, PRICES, REGIONS, regionForCountry, taxNote, TAX_INCLUSIVE } from "./regions";

describe("regions", () => {
  it("maps countries to regions, with everyone else on US prices", () => {
    expect(regionForCountry("gb").currency).toBe("gbp");
    expect(regionForCountry("UK").code).toBe("GB");
    expect(regionForCountry("IE").currency).toBe("eur");
    expect(regionForCountry("DE")).toMatchObject({ code: "XX", currency: "usd" });
    expect(regionForCountry("T1").code).toBe("US"); // Cloudflare's code for Tor
    expect(regionForCountry(null).code).toBe("US");
  });

  it("reads the country from the browser's languages", () => {
    expect(countryFromLanguages("en-GB,en;q=0.9")).toBe("GB");
    expect(countryFromLanguages("en,en-au;q=0.8")).toBe("AU");
    expect(countryFromLanguages("en")).toBeNull();
    expect(countryFromLanguages(null)).toBeNull();
  });

  it("has a price for every plan in every currency, and a tax rule for each", () => {
    for (const [currency, plans] of Object.entries(PRICES)) {
      expect(plans.monthly).toBeGreaterThan(0);
      expect(plans.annual).toBeGreaterThan(plans.monthly);
      expect(currency in TAX_INCLUSIVE).toBe(true);
    }
    for (const region of Object.values(REGIONS)) expect(region.currency in PRICES).toBe(true);
  });

  it("formats prices, amounts and dates for each country", () => {
    expect(formatPrice(15_00, "gbp", "en-GB")).toBe("£15");
    expect(formatPrice(25_00, "cad", "en-CA")).toBe("$25");
    expect(formatPrice(25_00, "cad", "en-US")).toBe("CA$25");
    expect(formatPrice(16_58, "usd", "en-US")).toBe("$16.58");
    expect(formatPrice(29_00, "aud", "en-AU")).toBe("$29");
    expect(formatAmount(15_00, "gbp", "en-GB")).toBe("£15.00");
    const d = new Date("2026-11-22T12:00:00Z");
    expect(formatDate(d, "en-US")).toBe("Nov 22, 2026");
    expect(formatDate(d, "en-GB")).toBe("22 Nov 2026");
  });

  it("says whether tax is included", () => {
    expect(taxNote(REGIONS.GB)).toBe("VAT included");
    expect(taxNote(REGIONS.AU)).toBe("GST included");
    expect(taxNote(REGIONS.US)).toBe("Plus sales tax where it applies");
    expect(taxNote(REGIONS.XX)).toBe("Plus tax where it applies");
  });
});
