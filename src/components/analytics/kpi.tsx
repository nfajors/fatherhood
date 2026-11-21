import { compare } from "@/lib/analytics/compare";
import { cn } from "@/lib/utils";

const TONE = { good: "text-emerald-800", bad: "text-red-800", neutral: "text-muted" } as const;
const ARROW = { up: "▲", down: "▼", flat: "–" } as const;

/** A stat tile: label, value (proportional figures), optional change vs the previous period and a note. */
export function Kpi({
  label,
  value,
  current,
  previous,
  upIsGood = true,
  period,
  detail,
  className,
}: {
  label: string;
  value: string;
  current?: number;
  previous?: number;
  upIsGood?: boolean;
  /** "previous 30 days" */
  period?: string;
  detail?: string;
  className?: string;
}) {
  const change = current !== undefined && previous !== undefined ? compare(current, previous, upIsGood) : null;
  return (
    <div className={cn("rounded-xl border border-navy-900/10 bg-white p-5 shadow-sm", className)}>
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {change && (
        <p className={cn("mt-1 text-xs", TONE[change.tone])}>
          <span aria-hidden>{ARROW[change.direction]} </span>
          <span className="font-semibold">{change.text}</span> <span className="text-muted">vs {period}</span>
        </p>
      )}
      {detail && <p className="mt-1 text-xs text-muted">{detail}</p>}
    </div>
  );
}

/** Named rows, each with a bar against the largest and its figure; one hue, aligned bars. */
export function MeterList({ rows, format = (v) => v.toLocaleString("en-US") }: { rows: { label: string; value: number }[]; format?: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[6rem_1fr_auto] items-center gap-3 text-sm">
          <span>{r.label}</span>
          <span className="h-2 rounded-full bg-gold-100" aria-hidden>
            <span className="block h-2 rounded-full bg-gold-600" style={{ width: r.value ? `${Math.max(2, (r.value / max) * 100)}%` : 0 }} />
          </span>
          <span className="text-right tabular-nums">{format(r.value)}</span>
        </li>
      ))}
    </ul>
  );
}
