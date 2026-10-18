/**
 * Site search (docs/development-plan.md 3.1 Search & Discovery): Postgres full
 * text over titles, descriptions, tags, lesson summaries and transcripts.
 * Search documents are generated columns (migration 0006) with GIN indexes.
 *
 * Only published things are found: published courses, lessons in them whose
 * video is approved, approved Community videos and active themes.
 */
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { courseModules, courses, lessons, themes, user, videos } from "@/lib/db/schema";
import { topRatedOrder } from "@/lib/ratings/policy";

export type SearchType = "all" | "courses" | "lessons" | "community";
export type SearchSort = "relevance" | "newest" | "top_rated" | "most_viewed";

export const SEARCH_TYPES: SearchType[] = ["all", "courses", "lessons", "community"];
export const SEARCH_SORTS: SearchSort[] = ["relevance", "newest", "top_rated", "most_viewed"];

/** Snippet highlight markers: unusual characters, so the page can split on them and render text safely. */
export const MARK_START = "⟦";
export const MARK_END = "⟧";

const HEADLINE_OPTIONS = `StartSel=${MARK_START}, StopSel=${MARK_END}, MaxWords=24, MinWords=10, MaxFragments=2, FragmentDelimiter=" … "`;

/** Trim, collapse whitespace and cap the length of what people type. */
export function normalizeQuery(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
}

/**
 * A prefix query for partly typed words, used when the exact search finds
 * nothing. Indexed words are stems ("coaching" is stored as "coach"), so a
 * fragment longer than its stem ("coachi") would never match; longer fragments
 * are trimmed back toward a stem first. Null when there are no usable words.
 */
export function prefixQuery(query: string): string | null {
  const words = (query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 8);
  return words.length ? words.map((w) => `${w.length > 5 ? w.slice(0, Math.max(4, w.length - 4)) : w}:*`).join(" & ") : null;
}

/** Quotes, "or" and "-word" mean the person wrote a precise query; don't loosen it. */
export function usesSearchSyntax(query: string): boolean {
  return /"|(^|\s)-\S|\sor\s/i.test(query);
}

/** Split a headline into plain and highlighted parts, for rendering without HTML. */
export function snippetParts(headline: string | null): { text: string; mark: boolean }[] {
  if (!headline) return [];
  const parts: { text: string; mark: boolean }[] = [];
  for (const [i, chunk] of headline.split(MARK_START).entries()) {
    if (i === 0) {
      if (chunk) parts.push({ text: chunk, mark: false });
      continue;
    }
    const [marked, ...rest] = chunk.split(MARK_END);
    if (marked) parts.push({ text: marked, mark: true });
    const after = rest.join(MARK_END);
    if (after) parts.push({ text: after, mark: false });
  }
  return parts;
}

type Options = { type: SearchType; sort: SearchSort; category?: string | null; limit: number; offset: number };

const isPublishedCommunity = and(eq(videos.type, "community"), eq(videos.status, "approved"));

async function searchCommunity(db: Database, tsq: SQL, o: Options) {
  const where = and(isPublishedCommunity, sql`${videos.searchVector} @@ ${tsq}`, o.category ? eq(videos.category, o.category) : undefined);
  const order = {
    relevance: [sql`ts_rank_cd(${videos.searchVector}, ${tsq}) desc`],
    newest: [sql`${videos.publishedAt} desc nulls last`],
    top_rated: topRatedOrder(videos.ratingAverage, videos.ratingCount),
    most_viewed: [desc(videos.viewCount)],
  }[o.sort];
  const [items, [count]] = await Promise.all([
    db
      .select({
        id: videos.id,
        title: videos.title,
        creatorName: user.name,
        thumbnailUrl: videos.thumbnailUrl,
        durationSeconds: videos.durationSeconds,
        publishedAt: videos.publishedAt,
        viewCount: videos.viewCount,
        ratingAverage: videos.ratingAverage,
        ratingCount: videos.ratingCount,
        snippet: sql<string>`ts_headline('english', concat_ws(' ', ${videos.description}, ${videos.transcript}), ${tsq}, ${HEADLINE_OPTIONS})`,
      })
      .from(videos)
      .innerJoin(user, eq(videos.creatorId, user.id))
      .where(where)
      .orderBy(...order, desc(videos.id))
      .limit(o.limit)
      .offset(o.offset),
    db.select({ n: sql<number>`count(*)::int` }).from(videos).where(where),
  ]);
  return { items, total: count?.n ?? 0 };
}

async function searchLessons(db: Database, tsq: SQL, o: Options) {
  const rank = sql`greatest(ts_rank_cd(${lessons.searchVector}, ${tsq}), ts_rank_cd(${videos.searchVector}, ${tsq}))`;
  const where = and(
    eq(courses.published, true),
    eq(videos.status, "approved"),
    sql`(${lessons.searchVector} @@ ${tsq} or ${videos.searchVector} @@ ${tsq})`,
    o.category ? eq(courses.category, o.category) : undefined,
  );
  const order = {
    relevance: [sql`${rank} desc`],
    newest: [sql`${videos.publishedAt} desc nulls last`],
    top_rated: topRatedOrder(videos.ratingAverage, videos.ratingCount),
    most_viewed: [desc(videos.viewCount)],
  }[o.sort];
  const [items, [count]] = await Promise.all([
    db
      .select({
        id: lessons.id,
        title: lessons.title,
        isPreview: lessons.isPreview,
        courseSlug: courses.slug,
        courseTitle: courses.title,
        durationSeconds: videos.durationSeconds,
        ratingAverage: videos.ratingAverage,
        ratingCount: videos.ratingCount,
        snippet: sql<string>`ts_headline('english', concat_ws(' ', ${lessons.summary}, ${videos.description}, ${videos.transcript}), ${tsq}, ${HEADLINE_OPTIONS})`,
      })
      .from(lessons)
      .innerJoin(courseModules, eq(lessons.moduleId, courseModules.id))
      .innerJoin(courses, eq(courseModules.courseId, courses.id))
      .innerJoin(videos, eq(lessons.videoId, videos.id))
      .where(where)
      .orderBy(...order, desc(lessons.id))
      .limit(o.limit)
      .offset(o.offset),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(lessons)
      .innerJoin(courseModules, eq(lessons.moduleId, courseModules.id))
      .innerJoin(courses, eq(courseModules.courseId, courses.id))
      .innerJoin(videos, eq(lessons.videoId, videos.id))
      .where(where),
  ]);
  return { items, total: count?.n ?? 0 };
}

/** Drizzle renders column refs unqualified inside select-list subqueries; pin this one. */
const COURSE_ID = sql.raw(`"courses"."id"`);

/** Per-course rating and views, from its approved lesson videos. */
const courseStat = (expr: string) =>
  sql.raw(`(select ${expr} from lessons l join course_modules m on m.id = l.module_id join videos v on v.id = l.video_id
    where m.course_id = "courses"."id" and v.status = 'approved')`);

async function searchCourses(db: Database, tsq: SQL, o: Options) {
  const lessonMatch = sql`exists (select 1 from lessons l join course_modules m on m.id = l.module_id join videos v on v.id = l.video_id
    where m.course_id = ${COURSE_ID} and v.status = 'approved' and (l.search_vector @@ ${tsq} or v.search_vector @@ ${tsq}))`;
  const where = and(
    eq(courses.published, true),
    sql`(${courses.searchVector} @@ ${tsq} or ${lessonMatch})`,
    o.category ? eq(courses.category, o.category) : undefined,
  );
  const ratingCount = courseStat("coalesce(sum(v.rating_count), 0)::int");
  const ratingAverage = courseStat("round(sum(v.rating_average * v.rating_count) / nullif(sum(v.rating_count), 0), 2)");
  const order = {
    // A match on the course itself ranks above one found only in its lessons.
    relevance: [sql`ts_rank_cd(${courses.searchVector}, ${tsq}) desc`, sql`${courses.publishedAt} desc nulls last`],
    newest: [sql`${courses.publishedAt} desc nulls last`],
    top_rated: topRatedOrder(ratingAverage, ratingCount),
    most_viewed: [sql`${courseStat("coalesce(sum(v.view_count), 0)")} desc`],
  }[o.sort];
  const [items, [count]] = await Promise.all([
    db
      .select({
        id: courses.id,
        slug: courses.slug,
        title: courses.title,
        subtitle: courses.subtitle,
        category: courses.category,
        coverImageUrl: courses.coverImageUrl,
        lessonCount: courseStat("count(*)::int").mapWith(Number),
        totalSeconds: courseStat("coalesce(sum(v.duration_seconds), 0)::int").mapWith(Number),
        ratingAverage: ratingAverage.mapWith((v) => (v === null ? null : Number(v))),
        ratingCount: ratingCount.mapWith(Number),
        matchedLessons: sql<number>`(select count(*)::int from lessons l join course_modules m on m.id = l.module_id join videos v on v.id = l.video_id
          where m.course_id = ${COURSE_ID} and v.status = 'approved' and (l.search_vector @@ ${tsq} or v.search_vector @@ ${tsq}))`,
      })
      .from(courses)
      .where(where)
      .orderBy(...order, desc(courses.id))
      .limit(o.limit)
      .offset(o.offset),
    db.select({ n: sql<number>`count(*)::int` }).from(courses).where(where),
  ]);
  return { items, total: count?.n ?? 0 };
}

async function searchThemes(db: Database, tsq: SQL) {
  return db
    .select({ slug: themes.slug, name: themes.name, description: themes.description })
    .from(themes)
    .where(and(eq(themes.status, "active"), sql`to_tsvector('english', ${themes.name} || ' ' || ${themes.description}) @@ ${tsq}`))
    .orderBy(sql`ts_rank_cd(to_tsvector('english', ${themes.name} || ' ' || ${themes.description}), ${tsq}) desc`)
    .limit(4);
}

export type SearchResults = Awaited<ReturnType<typeof search>>;

/** Previews per section on the "all" tab. */
const ALL_LIMITS = { courses: 3, lessons: 5, community: 6 } as const;

async function run(db: Database, tsq: SQL, options: Options) {
  const wants = (t: Exclude<SearchType, "all">) => options.type === "all" || options.type === t;
  const sectionOptions = (t: Exclude<SearchType, "all">): Options =>
    options.type === "all" ? { ...options, limit: ALL_LIMITS[t], offset: 0 } : options;
  const empty = { items: [], total: 0 };
  const [courseHits, lessonHits, communityHits, themeHits] = await Promise.all([
    wants("courses") ? searchCourses(db, tsq, sectionOptions("courses")) : empty,
    wants("lessons") ? searchLessons(db, tsq, sectionOptions("lessons")) : empty,
    wants("community") ? searchCommunity(db, tsq, sectionOptions("community")) : empty,
    options.type === "all" && !options.category ? searchThemes(db, tsq) : [],
  ]);
  return { courses: courseHits, lessons: lessonHits, community: communityHits, themes: themeHits };
}

/**
 * Search everything published. Uses web-search syntax ("quotes", or, -word);
 * when a plain query finds nothing, retries matching each word as a prefix.
 */
export async function search(
  db: Database,
  rawQuery: string,
  options: Partial<Options> = {},
) {
  const query = normalizeQuery(rawQuery);
  const o: Options = { type: options.type ?? "all", sort: options.sort ?? "relevance", category: options.category ?? null, limit: options.limit ?? 20, offset: options.offset ?? 0 };
  const exact = await run(db, sql`websearch_to_tsquery('english', ${query})`, o);
  const found = (r: typeof exact) => r.courses.total + r.lessons.total + r.community.total + r.themes.length;
  const prefix = usesSearchSyntax(query) ? null : prefixQuery(query);
  if (found(exact) > 0 || !prefix) return { query, matchedPrefixes: false, ...exact };
  const loose = await run(db, sql`to_tsquery('english', ${prefix})`, o);
  return { query, matchedPrefixes: found(loose) > 0, ...(found(loose) > 0 ? loose : exact) };
}
