/** A clean axis maximum: 1, 2, 5, 10, 20, 50... at or above the largest value. */
export function niceMax(value: number): number {
  if (value <= 1) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return [1, 2, 5, 10].map((m) => m * magnitude).find((step) => step >= value)!;
}

/** "Nov 3" or "Mon, Nov 3" for a YYYY-MM-DD day. */
export function dayLabel(day: string, style: "short" | "long" = "short"): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC", ...(style === "long" ? { weekday: "short" } : {}) });
}

/** "Nov" or "November 2026" for a YYYY-MM month. */
export function monthLabel(month: string, style: "short" | "long" = "short"): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", style === "long" ? { month: "long", year: "numeric", timeZone: "UTC" } : { month: "short", timeZone: "UTC" });
}

/** How a chart prints its values. Names, not functions, so server pages can pass them to client charts. */
export type ValueFormat = "number" | "money";

export function formatValue(value: number, format: ValueFormat = "number"): string {
  if (format === "money") {
    const dollars = value / 100;
    if (Math.abs(dollars) >= 100_000) return `$${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(dollars)}`;
    return dollars.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: Number.isInteger(dollars) ? 0 : 2 });
  }
  return value.toLocaleString("en-US");
}

/** "1 view", "3 views": unit words as [singular, plural]. */
export type Unit = readonly [string, string];
export const unitFor = (unit: Unit | undefined, n: number) => (unit ? (n === 1 ? unit[0] : unit[1]) : "");
