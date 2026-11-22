/** "just now", "5m", "3h", "2d", then a date. Pure. */
export function timeAgo(date: Date, now: Date = new Date()): string {
  const s = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)}d`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(date.getUTCFullYear() !== now.getUTCFullYear() ? { year: "numeric" } : {}), timeZone: "UTC" });
}
