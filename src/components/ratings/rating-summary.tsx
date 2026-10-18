import { Stars } from "./stars";

type Summary = { average: number | null; count: number; distribution: { stars: number; count: number }[] };

/** Average, count and how the ratings spread across 1-5 stars (each row labelled with its count). */
export function RatingSummary({ summary }: { summary: Summary }) {
  if (!summary.count || summary.average === null) return <p className="text-sm text-muted">No ratings yet.</p>;
  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
      <div>
        <p className="text-4xl font-semibold tabular-nums">{summary.average.toFixed(1)}</p>
        <Stars value={summary.average} className="mt-1 text-lg" />
        <p className="mt-1 text-sm text-muted">
          {summary.count} {summary.count === 1 ? "rating" : "ratings"}
        </p>
      </div>
      <ul className="min-w-48 flex-1 space-y-1.5 text-sm" aria-label="Ratings by stars">
        {summary.distribution.map((d) => (
          <li key={d.stars} className="flex items-center gap-2">
            <span className="w-8 shrink-0 tabular-nums text-muted">
              {d.stars} <span aria-hidden>★</span>
              <span className="sr-only">{d.stars === 1 ? "star" : "stars"}:</span>
            </span>
            <span aria-hidden className="h-2 flex-1 overflow-hidden rounded-full bg-gold-100">
              <span className="block h-full rounded-full bg-gold-600" style={{ width: `${(d.count / summary.count) * 100}%` }} />
            </span>
            <span className="w-8 shrink-0 text-right tabular-nums text-muted">{d.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
