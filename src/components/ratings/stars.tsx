import { cn } from "@/lib/utils";

/** Read-only stars with a partial fill, e.g. 4.6 fills four and a bit. */
export function Stars({ value, className }: { value: number; className?: string }) {
  const percent = Math.max(0, Math.min(100, (value / 5) * 100));
  return (
    <span role="img" aria-label={`${value.toFixed(1)} out of 5 stars`} className={cn("relative inline-block leading-none tracking-[0.1em]", className)}>
      <span aria-hidden className="text-navy-900/20">★★★★★</span>
      <span aria-hidden className="absolute inset-0 overflow-hidden whitespace-nowrap text-gold-600" style={{ width: `${percent}%` }}>
        ★★★★★
      </span>
    </span>
  );
}

/** Compact "★ 4.7 (18)" for cards; nothing until someone has rated. */
export function RatingBadge({ average, count, className }: { average: number | string | null; count: number; className?: string }) {
  if (!count || average === null) return null;
  const value = Number(average);
  return (
    <span className={cn("inline-flex items-center gap-1 text-sm text-navy-900", className)}>
      <span aria-hidden className="text-gold-600">★</span>
      <span className="font-semibold tabular-nums">{value.toFixed(1)}</span>
      <span className="text-muted tabular-nums">
        ({count}
        <span className="sr-only"> {count === 1 ? "rating" : "ratings"}</span>)
      </span>
    </span>
  );
}
