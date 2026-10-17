import { cn } from "@/lib/utils";
import { REVENUE_POLICY as P } from "@/lib/revenue/policy";

export function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-xl border border-navy-900/10 bg-white p-5 shadow-sm">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {detail && <p className="mt-1 text-xs text-muted">{detail}</p>}
    </div>
  );
}

type Estimate = {
  checks: { postedThisQuarter: boolean; videoReachedViewThreshold: boolean };
  videosPostedInQuarter: number;
  score: number;
};

/** The two pool requirements, each with an icon and words so it never relies on color. */
export function EligibilityChecklist({ estimate, className }: { estimate: Estimate; className?: string }) {
  const items = [
    {
      ok: estimate.checks.postedThisQuarter,
      text: `At least ${P.minVideosPerQuarter} video published this quarter`,
      detail: `${estimate.videosPostedInQuarter} so far`,
    },
    {
      ok: estimate.checks.videoReachedViewThreshold,
      text: `A video with ${P.minViewsPerVideo}+ views this month`,
      detail: estimate.checks.videoReachedViewThreshold ? "Done" : "Not yet",
    },
  ];
  return (
    <div className={className}>
      <ul className="space-y-2 text-sm">
        {items.map((item) => (
          <li key={item.text} className="flex gap-2">
            <span aria-hidden className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-bold", item.ok ? "bg-emerald-100 text-emerald-900" : "bg-navy-100 text-navy-900")}>
              {item.ok ? "✓" : "–"}
            </span>
            <span>
              <span className="sr-only">{item.ok ? "Met: " : "Not met yet: "}</span>
              {item.text}
              <span className="block text-xs text-muted">{item.detail}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted">Engagement score: {estimate.score.toFixed(1)} of 100</p>
    </div>
  );
}
