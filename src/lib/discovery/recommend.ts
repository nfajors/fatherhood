/**
 * "Recommended for you" (docs/development-plan.md 3.1: recommended next based
 * on watched content and ratings). Each person's taste is a weight per theme,
 * built from what they watched, finished and rated; unwatched Community videos
 * and unstarted courses are scored against it. People with no history get
 * what's popular instead.
 */
import { sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { communityCardsByIds, listPublishedCourses, type CommunityCard, type CourseCard } from "@/lib/courses/catalog";
import { RATING_POLICY } from "@/lib/ratings/policy";

export const RECOMMEND_POLICY = {
  /** A watch counts as interest after this much (the same bar as a view). */
  minWatchSeconds: RATING_POLICY.minWatchSeconds,
  /** Signal weights per video. Stars move taste up (4-5) or down (1-2). */
  weights: { watched: 1, completed: 1, perStarAboveThree: 1 },
  /** A theme that isn't the video's primary one counts for less. */
  secondaryThemeFactor: 0.6,
  /** How much a good rating lifts a candidate, next to theme fit. */
  ratingBoost: 0.3,
  /** Views in this many days make a video "trending". */
  trendingDays: 14,
} as const;

export type Recommended<T> = T & { reason: string | null };

const P = RECOMMEND_POLICY;

/** Policy numbers go into SQL as literals: as bind parameters Postgres would guess integer types. */
const num = (value: number) => sql.raw(String(Number(value)));

/** Weight per theme from this person's watching, finishing and rating. */
export async function tasteProfile(db: Database, userId: string): Promise<Map<string, number>> {
  const rows = await db.execute<{ theme_id: string; weight: number }>(sql`
    with engaged as (
      select v.id as video_id,
        ${num(P.weights.watched)}::float8
        + case when bool_or(p.completed) then ${num(P.weights.completed)} else 0 end
        + coalesce(max(r.stars) - 3, 0) * ${num(P.weights.perStarAboveThree)} as weight
      from videos v
      left join watch_progress p on p.video_id = v.id and p.user_id = ${userId}
      left join ratings r on r.video_id = v.id and r.user_id = ${userId}
      where v.status = 'approved' and v.creator_id <> ${userId} and (
        p.video_id is not null or r.id is not null or
        exists (select 1 from watch_sessions s where s.video_id = v.id and s.user_id = ${userId} and s.seconds_watched >= ${num(P.minWatchSeconds)})
      )
      group by v.id
    ),
    -- Lessons also count toward their course's themes.
    course_engaged as (
      select m.course_id, sum(e.weight) as weight
      from engaged e join lessons l on l.video_id = e.video_id join course_modules m on m.id = l.module_id
      group by m.course_id
    )
    select theme_id, sum(weight)::float8 as weight from (
      select a.theme_id, e.weight * case when a.is_primary then 1 else ${num(P.secondaryThemeFactor)} end as weight
      from engaged e join theme_assignments a on a.video_id = e.video_id and a.status = 'active'
      union all
      select a.theme_id, c.weight * case when a.is_primary then 1 else ${num(P.secondaryThemeFactor)} end
      from course_engaged c join theme_assignments a on a.course_id = c.course_id and a.status = 'active'
    ) t
    join themes th on th.id = t.theme_id and th.status = 'active'
    group by theme_id
  `);
  return new Map(rows.map((r) => [r.theme_id, Number(r.weight)]));
}

/** Bayesian average lifted to 0-1 (unrated videos sit at the prior mean, 0.5). */
const ratingTerm = (average: string, count: string) =>
  `((((${RATING_POLICY.prior.mean} * ${RATING_POLICY.prior.weight}) + coalesce(${average}, 0) * ${count}) / (${RATING_POLICY.prior.weight} + ${count})) - 3) / 2`;

type Scored = { id: string; reason: string | null };

function profileArrays(profile: Map<string, number>) {
  const ids = [...profile.keys()];
  return { ids: `{${ids.join(",")}}`, weights: `{${ids.map((id) => profile.get(id)).join(",")}}` };
}

async function scoreVideos(db: Database, userId: string, profile: Map<string, number>, limit: number): Promise<Scored[]> {
  const { ids, weights } = profileArrays(profile);
  const rows = await db.execute<{ id: string; reason: string | null }>(sql`
    with aff as (select * from unnest(${ids}::uuid[], ${weights}::float8[]) as a(theme_id, w))
    select v.id, (array_agg(th.name order by aff.w desc))[1] as reason
    from videos v
    join theme_assignments a on a.video_id = v.id and a.status = 'active'
    join aff on aff.theme_id = a.theme_id
    join themes th on th.id = a.theme_id and th.status = 'active'
    where v.type = 'community' and v.status = 'approved' and v.creator_id <> ${userId}
      and not exists (select 1 from watch_progress p where p.video_id = v.id and p.user_id = ${userId})
      and not exists (select 1 from watch_sessions s where s.video_id = v.id and s.user_id = ${userId} and s.seconds_watched >= ${num(P.minWatchSeconds)})
    group by v.id
    having sum(aff.w * case when a.is_primary then 1 else ${num(P.secondaryThemeFactor)} end) > 0
    order by sum(aff.w * case when a.is_primary then 1 else ${num(P.secondaryThemeFactor)} end)
      + ${num(P.ratingBoost)} * ${sql.raw(ratingTerm("v.rating_average", "v.rating_count"))} desc, v.published_at desc nulls last
    limit ${limit}
  `);
  return rows.map((r) => ({ id: r.id, reason: r.reason }));
}

async function scoreCourses(db: Database, userId: string, profile: Map<string, number>, limit: number): Promise<Scored[]> {
  const { ids, weights } = profileArrays(profile);
  const rows = await db.execute<{ id: string; reason: string | null }>(sql`
    with aff as (select * from unnest(${ids}::uuid[], ${weights}::float8[]) as a(theme_id, w))
    select c.id, (array_agg(th.name order by aff.w desc))[1] as reason
    from courses c
    join theme_assignments a on a.course_id = c.id and a.status = 'active'
    join aff on aff.theme_id = a.theme_id
    join themes th on th.id = a.theme_id and th.status = 'active'
    where c.published
      and not exists (
        select 1 from watch_progress p join lessons l on l.video_id = p.video_id join course_modules m on m.id = l.module_id
        where m.course_id = c.id and p.user_id = ${userId})
    group by c.id
    having sum(aff.w * case when a.is_primary then 1 else ${num(P.secondaryThemeFactor)} end) > 0
    order by sum(aff.w * case when a.is_primary then 1 else ${num(P.secondaryThemeFactor)} end) desc, c.published_at desc nulls last
    limit ${limit}
  `);
  return rows.map((r) => ({ id: r.id, reason: r.reason }));
}

/** Popular Community videos the person hasn't watched: views in the last two weeks, then rating. */
async function popularVideos(db: Database, userId: string | null, limit: number): Promise<Scored[]> {
  const rows = await db.execute<{ id: string }>(sql`
    select v.id from videos v
    where v.type = 'community' and v.status = 'approved'
      ${userId ? sql`and v.creator_id <> ${userId}
        and not exists (select 1 from watch_progress p where p.video_id = v.id and p.user_id = ${userId})
        and not exists (select 1 from watch_sessions s where s.video_id = v.id and s.user_id = ${userId} and s.seconds_watched >= ${num(P.minWatchSeconds)})` : sql``}
    order by (select count(*) from watch_sessions s where s.video_id = v.id and s.seconds_watched >= ${num(P.minWatchSeconds)}
                and s.started_at >= now() - make_interval(days => ${num(P.trendingDays)})) desc,
             ${sql.raw(ratingTerm("v.rating_average", "v.rating_count"))} desc, v.published_at desc nulls last
    limit ${limit}
  `);
  return rows.map((r) => ({ id: r.id, reason: null }));
}

function inOrder<T extends { id: string }>(cards: T[], scored: Scored[]): Recommended<T>[] {
  return scored.flatMap((s) => {
    const card = cards.find((c) => c.id === s.id);
    return card ? [{ ...card, reason: s.reason }] : [];
  });
}

/**
 * Recommendations for a person (or for a visitor: popular picks). Personal
 * picks come first; if there are too few, popular videos fill the rest.
 */
export async function recommendFor(
  db: Database,
  userId: string | null,
  options: { videos?: number; courses?: number } = {},
): Promise<{ personalized: boolean; videos: Recommended<CommunityCard>[]; courses: Recommended<CourseCard>[] }> {
  const videoLimit = options.videos ?? 6;
  const courseLimit = options.courses ?? 3;
  const profile = userId ? await tasteProfile(db, userId) : new Map<string, number>();
  const personalized = [...profile.values()].some((w) => w > 0);

  const [videoPicks, coursePicks] = personalized
    ? await Promise.all([scoreVideos(db, userId!, profile, videoLimit), scoreCourses(db, userId!, profile, courseLimit)])
    : [[], []];
  if (videoPicks.length < videoLimit) {
    const fill = await popularVideos(db, userId, videoLimit + videoPicks.length);
    for (const f of fill) if (videoPicks.length < videoLimit && !videoPicks.some((p) => p.id === f.id)) videoPicks.push(f);
  }

  const [videoCards, courseCards] = await Promise.all([
    communityCardsByIds(db, videoPicks.map((p) => p.id)),
    coursePicks.length ? listPublishedCourses(db, userId) : Promise.resolve([]),
  ]);
  return { personalized, videos: inOrder(videoCards, videoPicks), courses: inOrder(courseCards, coursePicks) };
}
