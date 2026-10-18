import type { Metadata } from "next";
import Link from "next/link";
import { RatingBadge } from "@/components/ratings/stars";
import { CATEGORIES } from "@/lib/config";
import { getDb } from "@/lib/db";
import { formatDuration } from "@/lib/format";
import { normalizeQuery, search, SEARCH_SORTS, SEARCH_TYPES, snippetParts, type SearchSort, type SearchType } from "@/lib/search/search";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Search", robots: { index: false } };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;
const TYPE_LABEL: Record<SearchType, string> = { all: "All", courses: "Courses", lessons: "Lessons", community: "Community Voices" };
const SORT_LABEL: Record<SearchSort, string> = { relevance: "Best match", newest: "Newest", top_rated: "Top rated", most_viewed: "Most viewed" };
const EXAMPLES = ["bedtime", "co-parenting", "teenagers", "apologizing to my kids", "working nights"];

type Params = { q?: string; type?: string; sort?: string; category?: string; page?: string };

function Snippet({ headline }: { headline: string | null }) {
  const parts = snippetParts(headline);
  if (parts.length === 0) return null;
  return (
    <span className="mt-1 line-clamp-2 block text-sm text-muted">
      {parts.map((p, i) =>
        p.mark ? (
          <mark key={i} className="rounded-sm bg-gold-100 px-0.5 text-navy-900">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </span>
  );
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const q = normalizeQuery(params.q);
  const type = SEARCH_TYPES.find((t) => t === params.type) ?? "all";
  const sort = SEARCH_SORTS.find((s) => s === params.sort) ?? "relevance";
  const category = CATEGORIES.find((c) => c === params.category) ?? null;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const results = q ? await search(getDb(), q, { type, sort, category, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }) : null;

  const href = (changes: Partial<Params>) => {
    const next = { q, type, sort, category: category ?? undefined, ...changes };
    return `/search?${new URLSearchParams(
      Object.entries(next).filter(([k, v]) => v && !(k === "type" && v === "all") && !(k === "sort" && v === "relevance") && !(k === "page" && v === "1")) as [string, string][],
    )}`;
  };
  const total = results ? results.courses.total + results.lessons.total + results.community.total + results.themes.length : 0;
  const sectionTotal = results && type !== "all" ? results[type].total : 0;
  const pages = Math.max(1, Math.ceil(sectionTotal / PAGE_SIZE));

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="text-4xl font-semibold">Search</h1>
      <form action="/search" role="search" className="mt-6 flex flex-wrap gap-3">
        <label className="min-w-0 flex-1 basis-64">
          <span className="sr-only">Search courses, lessons and stories</span>
          <input
            type="search"
            name="q"
            defaultValue={q}
            autoFocus={!q}
            maxLength={200}
            placeholder="Search courses, lessons and stories"
            className="block w-full rounded-md border border-navy-900/20 bg-white px-4 py-3 text-base"
          />
        </label>
        {type !== "all" && <input type="hidden" name="type" value={type} />}
        <label>
          <span className="sr-only">Category</span>
          <select name="category" defaultValue={category ?? ""} className="h-full rounded-md border border-navy-900/20 bg-white px-3 py-3 text-sm">
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <button type="submit" className="rounded-md bg-gold-500 px-5 py-3 text-sm font-semibold text-navy-950 hover:bg-gold-400">
          Search
        </button>
      </form>

      {!results ? (
        <div className="mt-8">
          <p className="text-muted">Search titles, descriptions and what&apos;s said in every video. Try:</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {EXAMPLES.map((e) => (
              <li key={e}>
                <Link href={`/search?q=${encodeURIComponent(e)}`} className="rounded-full border border-navy-900/15 bg-white px-3 py-1 text-sm hover:border-gold-500">
                  {e}
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-sm text-muted">
            Tip: put a phrase in &quot;quotes&quot;, use <em>or</em> between alternatives, or a minus to leave a word out (bedtime -toddlers).
          </p>
        </div>
      ) : (
        <>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-b border-navy-900/10">
            <nav aria-label="Result types" className="-mb-px flex gap-1 overflow-x-auto">
              {SEARCH_TYPES.map((t) => {
                const count = t === "all" ? null : type === "all" || type === t ? results[t].total : null;
                return (
                  <Link
                    key={t}
                    href={href({ type: t, page: undefined })}
                    aria-current={type === t ? "page" : undefined}
                    className={cn(
                      "whitespace-nowrap border-b-2 px-3 py-2 text-sm",
                      type === t ? "border-gold-500 font-semibold text-navy-900" : "border-transparent text-muted hover:text-navy-900",
                    )}
                  >
                    {TYPE_LABEL[t]}
                    {count !== null && <span className="ml-1 tabular-nums text-muted">({count})</span>}
                  </Link>
                );
              })}
            </nav>
            <nav aria-label="Sort results" className="flex flex-wrap gap-1 pb-2 text-sm">
              {SEARCH_SORTS.map((s) => (
                <Link
                  key={s}
                  href={href({ sort: s, page: undefined })}
                  aria-current={sort === s ? "true" : undefined}
                  className={cn("rounded-full px-3 py-1", sort === s ? "bg-gold-100 font-semibold" : "text-navy-900 hover:bg-navy-100")}
                >
                  {SORT_LABEL[s]}
                </Link>
              ))}
            </nav>
          </div>

          {results.matchedPrefixes && (
            <p className="mt-4 text-sm text-muted">No exact matches, so these are results for words starting with what you typed.</p>
          )}

          {total === 0 ? (
            <div className="mt-8">
              <p className="font-semibold">Nothing found for “{q}”{category ? ` in ${category}` : ""}.</p>
              <p className="mt-2 text-sm text-muted">Try fewer or different words{category ? ", or all categories" : ""}. You can also browse by theme.</p>
              <Link href="/themes" className="mt-4 inline-block text-sm font-semibold underline-offset-2 hover:underline">
                Browse themes →
              </Link>
            </div>
          ) : (
            <div className="mt-6 space-y-10">
              {results.themes.length > 0 && (
                <section aria-labelledby="r-themes">
                  <h2 id="r-themes" className="text-sm font-semibold uppercase tracking-widest text-muted">
                    Themes
                  </h2>
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {results.themes.map((t) => (
                      <li key={t.slug}>
                        <Link href={`/themes/${t.slug}`} className="rounded-full border border-navy-900/15 bg-white px-3 py-1 text-sm hover:border-gold-500">
                          {t.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {results.courses.items.length > 0 && (
                <section aria-labelledby="r-courses">
                  <h2 id="r-courses" className="text-xl font-semibold">
                    Courses
                  </h2>
                  <ul className="mt-3 divide-y divide-navy-900/10 rounded-xl border border-navy-900/10 bg-white">
                    {results.courses.items.map((c) => (
                      <li key={c.id}>
                        <Link href={`/academy/${c.slug}`} className="block p-4 hover:bg-paper">
                          {c.category && <p className="text-xs font-semibold uppercase tracking-widest text-gold-600">{c.category}</p>}
                          <p className="font-semibold">{c.title}</p>
                          {c.subtitle && <p className="text-sm text-muted">{c.subtitle}</p>}
                          <p className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-muted">
                            <span>
                              {c.lessonCount} {c.lessonCount === 1 ? "lesson" : "lessons"}
                              {c.totalSeconds ? ` · ${formatDuration(c.totalSeconds)}` : ""}
                              {c.matchedLessons ? ` · ${c.matchedLessons} matching ${c.matchedLessons === 1 ? "lesson" : "lessons"}` : ""}
                            </span>
                            <RatingBadge average={c.ratingAverage} count={c.ratingCount} className="text-xs" />
                          </p>
                        </Link>
                      </li>
                    ))}
                  </ul>
                  {type === "all" && results.courses.total > results.courses.items.length && (
                    <Link href={href({ type: "courses" })} className="mt-2 inline-block text-sm font-semibold underline-offset-2 hover:underline">
                      See all {results.courses.total} courses →
                    </Link>
                  )}
                </section>
              )}

              {results.lessons.items.length > 0 && (
                <section aria-labelledby="r-lessons">
                  <h2 id="r-lessons" className="text-xl font-semibold">
                    Lessons
                  </h2>
                  <ul className="mt-3 divide-y divide-navy-900/10 rounded-xl border border-navy-900/10 bg-white">
                    {results.lessons.items.map((l) => (
                      <li key={l.id}>
                        <Link href={`/academy/${l.courseSlug}/${l.id}`} className="block p-4 hover:bg-paper">
                          <p className="flex flex-wrap items-baseline gap-x-2">
                            <span className="font-semibold">{l.title}</span>
                            <span className={cn("rounded px-1.5 text-xs", l.isPreview ? "bg-gold-100 text-gold-600" : "bg-navy-100 text-navy-900")}>
                              {l.isPreview ? "Free preview" : "Members"}
                            </span>
                          </p>
                          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted">
                            <span>
                              {l.courseTitle}
                              {l.durationSeconds ? ` · ${formatDuration(l.durationSeconds)}` : ""}
                            </span>
                            <RatingBadge average={l.ratingAverage} count={l.ratingCount} className="text-xs" />
                          </p>
                          <Snippet headline={l.snippet} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                  {type === "all" && results.lessons.total > results.lessons.items.length && (
                    <Link href={href({ type: "lessons" })} className="mt-2 inline-block text-sm font-semibold underline-offset-2 hover:underline">
                      See all {results.lessons.total} lessons →
                    </Link>
                  )}
                </section>
              )}

              {results.community.items.length > 0 && (
                <section aria-labelledby="r-community">
                  <h2 id="r-community" className="text-xl font-semibold">
                    Community Voices
                  </h2>
                  <ul className="mt-3 divide-y divide-navy-900/10 rounded-xl border border-navy-900/10 bg-white">
                    {results.community.items.map((v) => (
                      <li key={v.id}>
                        <Link href={`/community/${v.id}`} className="flex gap-4 p-4 hover:bg-paper">
                          {v.thumbnailUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element -- Stream thumbnail
                            <img src={v.thumbnailUrl} alt="" className="hidden aspect-video w-36 shrink-0 rounded object-cover sm:block" />
                          ) : (
                            <span aria-hidden className="hidden aspect-video w-36 shrink-0 rounded bg-navy-100 sm:block" />
                          )}
                          <span className="min-w-0">
                            <span className="block font-semibold">{v.title}</span>
                            <span className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted">
                              <span>
                                {v.creatorName}
                                {v.durationSeconds ? ` · ${formatDuration(v.durationSeconds)}` : ""}
                              </span>
                              <RatingBadge average={v.ratingAverage} count={v.ratingCount} className="text-xs" />
                            </span>
                            <Snippet headline={v.snippet} />
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                  {type === "all" && results.community.total > results.community.items.length && (
                    <Link href={href({ type: "community" })} className="mt-2 inline-block text-sm font-semibold underline-offset-2 hover:underline">
                      See all {results.community.total} Community Voices →
                    </Link>
                  )}
                </section>
              )}

              {type !== "all" && pages > 1 && (
                <nav aria-label="Pages" className="flex items-center justify-center gap-4 text-sm">
                  {page > 1 && (
                    <Link href={href({ page: String(page - 1) })} className="underline">
                      ← Previous
                    </Link>
                  )}
                  <span className="text-muted">
                    Page {page} of {pages}
                  </span>
                  {page < pages && (
                    <Link href={href({ page: String(page + 1) })} className="underline">
                      Next →
                    </Link>
                  )}
                </nav>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
