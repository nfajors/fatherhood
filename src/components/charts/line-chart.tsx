"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { formatValue, niceMax, unitFor, type Unit, type ValueFormat } from "./scale";

export type LinePoint = { key: string; label: string; longLabel: string; value: number };

const W = 640;
const H = 160;

/**
 * One series over time: a 2px gold line on a light wash, with a crosshair that
 * snaps to the nearest day (pointer or arrow keys), the latest value labeled at
 * the end, and the same numbers as a table.
 */
export function LineChart({
  points,
  format: formatName = "number",
  unit,
  tableHeading,
  ariaLabel,
}: {
  points: LinePoint[];
  format?: ValueFormat;
  unit?: Unit;
  tableHeading: string;
  ariaLabel: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const format = (v: number) => formatValue(v, formatName);
  const box = useRef<HTMLDivElement>(null);
  const max = niceMax(Math.max(0, ...points.map((p) => p.value)));
  const x = (i: number) => (points.length <= 1 ? W / 2 : (i / (points.length - 1)) * W);
  const y = (v: number) => H - (v / max) * H;
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = points.length ? `${path} L${x(points.length - 1)},${H} L${x(0)},${H} Z` : "";
  const last = points.at(-1);

  function track(event: PointerEvent<HTMLDivElement>) {
    const rect = box.current?.getBoundingClientRect();
    if (!rect || points.length === 0) return;
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    setActive(Math.round(ratio * (points.length - 1)));
  }
  function keys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const end = points.length - 1;
    setActive((i) => {
      if (event.key === "Home") return 0;
      if (event.key === "End") return end;
      const from = i ?? end;
      return Math.min(end, Math.max(0, from + (event.key === "ArrowLeft" ? -1 : 1)));
    });
  }
  const shown = active !== null ? points[active] : undefined;

  return (
    <figure>
      <div className="flex gap-2">
        <div className="flex h-40 w-12 shrink-0 flex-col justify-between text-right text-xs tabular-nums text-muted" aria-hidden>
          <span className="-translate-y-1/2">{format(max)}</span>
          <span className="translate-y-1/2">{format(0)}</span>
        </div>
        <div
          ref={box}
          role="group"
          tabIndex={0}
          aria-label={`${ariaLabel}. Use the arrow keys to read each day.`}
          className="relative h-40 min-w-0 flex-1 touch-pan-y outline-none focus-visible:ring-2 focus-visible:ring-navy-900"
          onPointerMove={track}
          onPointerDown={track}
          onPointerLeave={() => setActive(null)}
          onKeyDown={keys}
          onBlur={() => setActive(null)}
        >
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
            <line x1={0} x2={W} y1={0} y2={0} className="stroke-navy-900/10" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <line x1={0} x2={W} y1={H} y2={H} className="stroke-navy-900/20" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <path d={area} className="fill-gold-600/10" />
            <path d={path} fill="none" className="stroke-gold-600" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            {shown && active !== null && (
              <line x1={x(active)} x2={x(active)} y1={0} y2={H} className="stroke-navy-900/40" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            )}
          </svg>
          {/* Markers are HTML so they stay round when the SVG stretches. */}
          {last && (
            <span
              aria-hidden
              className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gold-600 ring-2 ring-white"
              style={{ left: "100%", top: `${(y(last.value) / H) * 100}%` }}
            />
          )}
          {shown && active !== null && (
            <span
              aria-hidden
              className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gold-600 ring-2 ring-white"
              style={{ left: `${(x(active) / W) * 100}%`, top: `${(y(shown.value) / H) * 100}%` }}
            />
          )}
          {last && !shown && (
            <span
              aria-hidden
              className="pointer-events-none absolute right-0 -translate-y-full pb-2 text-xs font-semibold tabular-nums text-navy-900"
              style={{ top: `${(y(last.value) / H) * 100}%` }}
            >
              {format(last.value)}
            </span>
          )}
          {shown && active !== null && (
            <div
              role="status"
              className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-md border border-navy-900/10 bg-white px-3 py-2 text-sm shadow-md"
              style={{ left: `${Math.min(85, Math.max(15, (x(active) / W) * 100))}%` }}
            >
              <strong className="block tabular-nums">{format(shown.value)}</strong>
              <span className="whitespace-nowrap text-xs text-muted">
                {unit ? `${unitFor(unit, shown.value)} · ` : ""}
                {shown.longLabel}
              </span>
            </div>
          )}
        </div>
      </div>
      <div className="ml-14 mt-2 flex justify-between text-xs text-muted" aria-hidden>
        <span>{points[0]?.label}</span>
        <span>{last?.label}</span>
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
            {points.map((p) => (
              <tr key={p.key} className="border-t border-navy-900/5">
                <td className="py-1">{p.longLabel}</td>
                <td className="py-1 text-right tabular-nums">{format(p.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
