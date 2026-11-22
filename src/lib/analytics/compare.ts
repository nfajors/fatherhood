/** How a figure moved against the previous period, in words. Pure. */
export type Change = { direction: "up" | "down" | "flat"; text: string; tone: "good" | "bad" | "neutral" };

/**
 * "+12%", "−40%", "15×" (ten times or more), "New" (nothing before) or "No change". `upIsGood` says whether a
 * rise is good news (members) or bad (cancellations).
 */
export function compare(current: number, previous: number, upIsGood = true): Change {
  if (current === previous) return { direction: "flat", text: "No change", tone: "neutral" };
  const direction = current > previous ? "up" : "down";
  const tone = (direction === "up") === upIsGood ? "good" : "bad";
  if (previous === 0) return { direction, text: "New", tone };
  // From a small base, a multiple reads better than "+1400%".
  if (current >= previous * 10) return { direction, text: `${Math.round(current / previous).toLocaleString("en-US")}×`, tone };
  const pct = Math.round((Math.abs(current - previous) / previous) * 100);
  return { direction, text: `${direction === "up" ? "+" : "−"}${pct < 1 ? "<1" : pct}%`, tone };
}

/** "34%", "<1%", or "–" when there is nothing to divide by. */
export function percent(rate: number | null): string {
  if (rate === null) return "–";
  if (rate > 0 && rate < 0.005) return "<1%";
  return `${Math.round(rate * 100)}%`;
}
