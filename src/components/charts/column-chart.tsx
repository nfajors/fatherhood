"use client";

import { useState } from "react";
import { formatValue, niceMax, unitFor, type Unit, type ValueFormat } from "./scale";

export type Column = {
  key: string;
  /** Axis label for the first and last column. */
  label: string;
  /** Full label for the tooltip, table and screen readers. */
  longLabel: string;
  value: number;
};

/**
 * One series as columns, in the brand gold. Single series, so no legend: the
 * heading names it. Each column shows its value on hover or focus, the largest
 * is labeled, and the same numbers are available as a table.
 */
export function ColumnChart({
  columns,
  format: formatName = "number",
  unit,
  emptyText,
  tableHeading,
}: {
  columns: Column[];
  format?: ValueFormat;
  /** Unit words, e.g. ["view", "views"]. */
  unit?: Unit;
  emptyText: string;
  /** Column heading for the label column in the table view. */
  tableHeading: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const format = (v: number) => formatValue(v, formatName);
  const max = niceMax(Math.max(0, ...columns.map((c) => c.value)));
  const peak = columns.reduce((best, c, i) => (c.value > (columns[best]?.value ?? 0) ? i : best), 0);
  const total = columns.reduce((sum, c) => sum + c.value, 0);
  const describe = (c: Column) => `${c.longLabel}: ${format(c.value)}${unit ? ` ${unitFor(unit, c.value)}` : ""}`;

  return (
    <figure>
      <div className="relative flex h-40 gap-2">
        <div className="flex w-12 shrink-0 flex-col justify-between text-right text-xs tabular-nums text-muted" aria-hidden>
          <span className="-translate-y-1/2">{format(max)}</span>
          <span className="translate-y-1/2">{format(0)}</span>
        </div>
        <div className="relative min-w-0 flex-1">
          <div className="absolute inset-x-0 top-0 border-t border-navy-900/10" aria-hidden />
          <div className="absolute inset-x-0 bottom-0 border-t border-navy-900/20" aria-hidden />
          <ol className="absolute inset-0 flex items-end" onPointerLeave={() => setActive(null)}>
            {columns.map((c, i) => (
              <li key={c.key} className="flex h-full min-w-0 flex-1 items-end justify-center px-px">
                <button
                  type="button"
                  className="group flex h-full w-full cursor-default items-end justify-center outline-none"
                  aria-label={describe(c)}
                  onPointerEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                >
                  <span
                    className={`block w-full max-w-6 rounded-t-[4px] ${c.value ? "bg-gold-600" : ""} ${active === i ? "opacity-100" : active === null ? "" : "opacity-60"} group-focus-visible:ring-2 group-focus-visible:ring-navy-900`}
                    style={{ height: c.value ? `${Math.max(2, (c.value / max) * 100)}%` : 0 }}
                  />
                </button>
              </li>
            ))}
          </ol>
          {total === 0 && <p className="absolute inset-0 flex items-center justify-center text-sm text-muted">{emptyText}</p>}
          {active !== null && columns[active] && (
            <div
              role="status"
              className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-md border border-navy-900/10 bg-white px-3 py-2 text-sm shadow-md"
              style={{ left: `${Math.min(85, Math.max(15, ((active + 0.5) / columns.length) * 100))}%` }}
            >
              <strong className="block tabular-nums">{format(columns[active].value)}</strong>
              <span className="whitespace-nowrap text-xs text-muted">
                {unit ? `${unitFor(unit, columns[active].value)} · ` : ""}
                {columns[active].longLabel}
              </span>
            </div>
          )}
          {total > 0 && active === null && columns[peak]!.value > 0 && (
            <span
              className="pointer-events-none absolute -translate-x-1/2 whitespace-nowrap text-xs font-semibold tabular-nums text-navy-900"
              style={{
                left: `${Math.min(92, Math.max(8, ((peak + 0.5) / columns.length) * 100))}%`,
                bottom: `calc(${(columns[peak]!.value / max) * 100}% + 4px)`,
              }}
              aria-hidden
            >
              {format(columns[peak]!.value)}
            </span>
          )}
        </div>
      </div>
      <div className="ml-14 mt-2 flex justify-between text-xs text-muted" aria-hidden>
        <span>{columns[0]?.label}</span>
        <span>{columns.at(-1)?.label}</span>
      </div>
      <details className="ml-14 mt-3 text-sm">
        <summary className="cursor-pointer text-muted underline-offset-2 hover:underline">View as table</summary>
        <table className="mt-2 w-full max-w-xs text-left text-sm">
          <thead>
            <tr className="text-muted">
              <th className="py-1 font-normal">{tableHeading}</th>
              <th className="py-1 text-right font-normal">Value</th>
            </tr>
          </thead>
          <tbody>
            {columns.map((c) => (
              <tr key={c.key} className="border-t border-navy-900/5">
                <td className="py-1">{c.longLabel}</td>
                <td className="py-1 text-right tabular-nums">{format(c.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
