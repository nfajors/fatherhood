/** Rating rules, shared by the ratings service, the catalog and search. */
import { sql, type SQL } from "drizzle-orm";

export const RATING_POLICY = {
  /** Watch at least this much of a video before rating it (the same bar as a counted view). */
  minWatchSeconds: 30,
  maxReviewChars: 2000,
  /**
   * "Top rated" ranks by a Bayesian average: as if every video started with
   * `weight` ratings of `mean`, so one 5-star rating doesn't outrank fifty 4.8s.
   */
  prior: { mean: 4, weight: 5 },
} as const;

/** SQL for the Bayesian average used to sort by "top rated". */
export function bayesianRating(average: unknown, count: unknown): SQL {
  const { mean, weight } = RATING_POLICY.prior;
  return sql`((${mean}::numeric * ${weight}) + coalesce(${average}, 0) * ${count}) / (${weight} + ${count})`;
}

/** "Top rated" ordering: rated before unrated, then by Bayesian average. */
export function topRatedOrder(average: unknown, count: unknown): SQL[] {
  return [sql`(${count} > 0) desc`, sql`${bayesianRating(average, count)} desc`];
}
