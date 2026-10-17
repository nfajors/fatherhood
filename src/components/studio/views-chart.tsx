"use client";

import { useState } from "react";

type Day = { day: string; views: number };

const label = (day: string, style: "short" | "long" = "short") =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC", ...(style === "long" ? { weekday: "short" } : {}) });

/** A clean axis maximum: 1, 2, 5, 10, 20, 50... at or above the busiest day. */
function niceMax(value: number): number {
  if (value <= 1) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return [1, 2, 5, 10].map((m) => m * magnitude).find((step) => step >= value)!;
}

/**
 * Counted views per day, as columns. Single series, so no legend: the heading
 * names it. Each column shows its value on hover or focus, and the same numbers
 * are available as a table.
 */
export function ViewsChart({ days }: { days: Day[] }) {
  const [active, setActive] = useState<number | null>(null);
  const max = niceMax(Math.max(0, ...days.map((d) => d.views)));
  const peak = days.reduce((best, d, i) => (d.views > (days[best]?.views ?? 0) ? i : best), 0);
  const total = days.reduce((sum, d) => sum + d.views, 0);

  return (
    <figure>
      <div className="relative flex h-40 gap-2">
        <div className="flex w-6 flex-col justify-between text-right text-xs tabular-nums text-muted" aria-hidden>
          <span className="-translate-y-1/2">{max}</span>
          <span className="translate-y-1/2">0</span>
        </div>
        <div className="relative flex-1">
          <div className="absolute inset-x-0 top-0 border-t border-navy-900/10" aria-hidden />
          <div className="absolute inset-x-0 bottom-0 border-t border-navy-900/20" aria-hidden />
          <ol className="absolute inset-0 flex items-end" onPointerLeave={() => setActive(null)}>
            {days.map((d, i) => (
              <li key={d.day} className="flex h-full flex-1 items-end justify-center px-px">
                <button
                  type="button"
                  className="group flex h-full w-full cursor-default items-end justify-center outline-none"
                  aria-label={`${label(d.day, "long")}: ${d.views} ${d.views === 1 ? "view" : "views"}`}
                  onPointerEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                >
                  <span
                    className={`block w-full max-w-6 rounded-t-[4px] ${d.views ? "bg-gold-600" : ""} ${active === i ? "opacity-100" : active === null ? "" : "opacity-60"} group-focus-visible:ring-2 group-focus-visible:ring-navy-900`}
                    style={{ height: d.views ? `${Math.max(2, (d.views / max) * 100)}%` : 0 }}
                  />
                </button>
              </li>
            ))}
          </ol>
          {total === 0 && (
            <p className="absolute inset-0 flex items-center justify-center text-sm text-muted">No views in the last 30 days yet.</p>
          )}
          {active !== null && days[active] && (
            <div
              role="status"
              className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-md border border-navy-900/10 bg-white px-3 py-2 text-sm shadow-md"
              style={{ left: `${((active + 0.5) / days.length) * 100}%` }}
            >
              <strong className="block tabular-nums">{days[active].views.toLocaleString("en-US")}</strong>
              <span className="whitespace-nowrap text-xs text-muted">{days[active].views === 1 ? "view" : "views"} · {label(days[active].day, "long")}</span>
            </div>
          )}
          {total > 0 && active === null && days[peak]!.views > 0 && (
            <span
              className="pointer-events-none absolute -translate-x-1/2 text-xs font-semibold tabular-nums text-navy-900"
              style={{ left: `${((peak + 0.5) / days.length) * 100}%`, bottom: `calc(${(days[peak]!.views / max) * 100}% + 4px)` }}
              aria-hidden
            >
              {days[peak]!.views}
            </span>
          )}
        </div>
      </div>
      <div className="ml-8 mt-2 flex justify-between text-xs text-muted" aria-hidden>
        <span>{label(days[0]!.day)}</span>
        <span>{label(days.at(-1)!.day)}</span>
      </div>
      <details className="ml-8 mt-3 text-sm">
        <summary className="cursor-pointer text-muted underline-offset-2 hover:underline">View as table</summary>
        <table className="mt-2 w-full max-w-xs text-left text-sm">
          <thead>
            <tr className="text-muted">
              <th className="py-1 font-normal">Day</th>
              <th className="py-1 text-right font-normal">Views</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.day} className="border-t border-navy-900/5">
                <td className="py-1">{label(d.day, "long")}</td>
                <td className="py-1 text-right tabular-nums">{d.views}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
