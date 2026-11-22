/**
 * Markets and local prices (international expansion: English-speaking countries
 * first). Each region has a currency, a locale for dates and numbers, and whether
 * prices include tax there. Everywhere else is shown US prices in dollars.
 *
 * Prices are set here, by you; `npm run stripe:prices` adds them to the Stripe
 * prices as currency options, so Checkout charges exactly these amounts.
 * Safe to import from client components (no server-only code).
 */
import type { PlanId } from "@/lib/config";

export type Currency = "usd" | "gbp" | "eur" | "cad" | "aud" | "nzd";

/** Plan prices in minor units (cents, pence), per currency. */
export const PRICES: Record<Currency, Record<PlanId, number>> = {
  usd: { monthly: 19_00, annual: 199_00 },
  gbp: { monthly: 15_00, annual: 159_00 },
  eur: { monthly: 17_00, annual: 179_00 },
  cad: { monthly: 25_00, annual: 259_00 },
  aud: { monthly: 29_00, annual: 299_00 },
  nzd: { monthly: 32_00, annual: 329_00 },
};

/** Where prices include VAT or GST (shown as the total); elsewhere tax is added at checkout. */
export const TAX_INCLUSIVE: Record<Currency, boolean> = { usd: false, cad: false, gbp: true, eur: true, aud: true, nzd: true };

export type RegionCode = "US" | "GB" | "CA" | "AU" | "NZ" | "IE" | "XX";

export type Region = { code: RegionCode; name: string; currency: Currency; locale: string; taxName: string | null };

export const REGIONS: Record<RegionCode, Region> = {
  US: { code: "US", name: "United States", currency: "usd", locale: "en-US", taxName: "sales tax" },
  GB: { code: "GB", name: "United Kingdom", currency: "gbp", locale: "en-GB", taxName: "VAT" },
  CA: { code: "CA", name: "Canada", currency: "cad", locale: "en-CA", taxName: "sales tax" },
  AU: { code: "AU", name: "Australia", currency: "aud", locale: "en-AU", taxName: "GST" },
  NZ: { code: "NZ", name: "New Zealand", currency: "nzd", locale: "en-NZ", taxName: "GST" },
  IE: { code: "IE", name: "Ireland", currency: "eur", locale: "en-IE", taxName: "VAT" },
  /** Every other country: US prices, in dollars, tax added where it applies. */
  XX: { code: "XX", name: "Other countries", currency: "usd", locale: "en-US", taxName: null },
};

export const DEFAULT_REGION = REGIONS.US;

/** The region for a two-letter country code ("UK" counts as GB). Unknown countries get "Other countries". */
export function regionForCountry(country: string | null | undefined): Region {
  const code = (country ?? "").trim().toUpperCase().replace(/^UK$/, "GB");
  if (!/^[A-Z]{2}$/.test(code)) return DEFAULT_REGION;
  return code in REGIONS && code !== "XX" ? REGIONS[code as RegionCode] : REGIONS.XX;
}

/** The country in an Accept-Language header ("en-GB,en;q=0.9" -> "GB"), if any. */
export function countryFromLanguages(header: string | null | undefined): string | null {
  for (const part of (header ?? "").split(",")) {
    const tag = part.split(";")[0]!.trim();
    const m = /^[a-z]{2,3}-([A-Za-z]{2})$/.exec(tag);
    if (m) return m[1]!.toUpperCase();
  }
  return null;
}

export const isCurrency = (value: string | null | undefined): value is Currency => Boolean(value && value in PRICES);

export function priceFor(plan: PlanId, currency: Currency): number {
  return PRICES[currency][plan];
}

/** "$19", "£15", "CA$25", "A$29.50": no ".00" on round amounts. */
export function formatPrice(minor: number, currency: Currency, locale: string): string {
  const amount = minor / 100;
  return new Intl.NumberFormat(locale, { style: "currency", currency: currency.toUpperCase(), maximumFractionDigits: Number.isInteger(amount) ? 0 : 2, minimumFractionDigits: Number.isInteger(amount) ? 0 : 2 }).format(amount);
}

/** Money with cents always shown ("£15.00"), for receipts and balances. */
export function formatAmount(minor: number, currency: Currency | string, locale = "en-US"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency: currency.toUpperCase() }).format(minor / 100);
}

/** Under a price: "VAT included" where prices include it, "Plus sales tax where it applies" elsewhere. */
export function taxNote(region: Region): string {
  if (TAX_INCLUSIVE[region.currency] && region.taxName) return `${region.taxName} included`;
  return region.taxName ? `Plus ${region.taxName} where it applies` : "Plus tax where it applies";
}

/** Dates in the region's style: "Nov 22, 2026" (US) or "22 Nov 2026" (UK). */
export function formatDate(date: Date, locale: string, style: "medium" | "long" = "medium"): string {
  return date.toLocaleDateString(locale, { dateStyle: style, timeZone: "UTC" });
}
