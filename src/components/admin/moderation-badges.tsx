import type { SlaState } from "@/lib/moderation/decide";
import { cn } from "@/lib/utils";

const RISK = {
  high: "bg-red-100 text-red-800",
  medium: "bg-amber-100 text-amber-900",
  low: "bg-emerald-100 text-emerald-900",
} as const;

export function RiskBadge({ risk, recommendation }: { risk: keyof typeof RISK | null; recommendation: string | null }) {
  if (!risk) return <span className="rounded bg-navy-100 px-2 py-0.5 text-xs text-navy-900">AI screen pending</span>;
  return (
    <span className={cn("rounded px-2 py-0.5 text-xs font-semibold", RISK[risk])}>
      {risk} risk{recommendation ? ` · AI: ${recommendation}` : ""}
    </span>
  );
}

const SLA = {
  overdue: ["bg-red-100 text-red-800", "Overdue"],
  due_soon: ["bg-amber-100 text-amber-900", "Due soon"],
  on_track: ["bg-navy-100 text-navy-900", "On track"],
} as const;

export function SlaBadge({ sla, dueAt }: { sla: SlaState; dueAt: Date | null }) {
  const [style, label] = SLA[sla];
  const due = dueAt?.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return <span className={cn("rounded px-2 py-0.5 text-xs", style)}>{due ? `${label} · due ${due}` : label}</span>;
}
