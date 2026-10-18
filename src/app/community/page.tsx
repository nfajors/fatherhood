import type { Metadata } from "next";
import Link from "next/link";
import { VideoCardView } from "@/components/catalog/cards";
import { CollectionShelf } from "@/components/collections/shelf";
import { RecommendedSection } from "@/components/discovery/recommended";
import { getSessionUser } from "@/lib/auth";
import { publishedCollections } from "@/lib/collections/service";
import { communityThemes, listCommunityVideos, type CommunitySort } from "@/lib/courses/catalog";
import { getDb } from "@/lib/db";
import { recommendFor } from "@/lib/discovery/recommend";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Community Voices",
  description: "Short, honest videos from fathers: stories, lessons and what they wish they had known. Free for everyone.",
};
export const dynamic = "force-dynamic";

const PAGE_SIZE = 24;

const SORTS: { value: CommunitySort; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "trending", label: "Trending" },
  { value: "top_rated", label: "Top rated" },
  { value: "most_viewed", label: "Most viewed" },
];

export default async function CommunityPage({ searchParams }: { searchParams: Promise<{ theme?: string; page?: string; sort?: string }> }) {
  const { theme, page, sort: rawSort } = await searchParams;
  const sort = SORTS.find((s) => s.value === rawSort)?.value ?? "newest";
  const pageNumber = Math.max(1, Number.parseInt(page ?? "1", 10) || 1);
  const db = getDb();
  const sessionUser = await getSessionUser().catch(() => null);
  // Discovery rows only on the unfiltered first page.
  const browsing = !theme && pageNumber === 1;
  const [{ videos, total }, themes, featured, recs] = await Promise.all([
    listCommunityVideos(db, { themeSlug: theme, sort, limit: PAGE_SIZE, offset: (pageNumber - 1) * PAGE_SIZE }),
    communityThemes(db),
    browsing ? publishedCollections(db, { featuredOnly: true, preview: 6, userId: sessionUser?.id ?? null }) : Promise.resolve([]),
    browsing && sessionUser ? recommendFor(db, sessionUser.id, { videos: 3, courses: 0 }) : Promise.resolve(null),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (p: number, s: CommunitySort = sort, t: string | undefined = theme) =>
    `/community?${new URLSearchParams({ ...(t ? { theme: t } : {}), ...(s !== "newest" ? { sort: s } : {}), ...(p > 1 ? { page: String(p) } : {}) })}`;

  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <h1 className="text-4xl font-semibold">Community Voices</h1>
      <p className="mt-4 max-w-2xl text-lg text-muted">
        Short stories and practical lessons from fathers who have walked the road. Free for everyone.{" "}
        <Link href="/fellows" className="whitespace-nowrap text-navy-900 underline underline-offset-2">
          Share yours
        </Link>
      </p>

      {featured.length > 0 && (
        <div className="mt-10 space-y-10">
          {featured.map((f) => (
            <CollectionShelf key={f.collection.id} collection={f.collection} entries={f.entries} total={f.total} />
          ))}
        </div>
      )}
      {recs?.personalized && (
        <div className="mt-10">
          <RecommendedSection recs={recs} />
        </div>
      )}
      {(featured.length > 0 || recs?.personalized) && (
        <h2 className="mt-14 text-2xl font-semibold">All stories</h2>
      )}

      {themes.length > 0 && (
        <nav aria-label="Themes" className="mt-8 flex flex-wrap gap-2">
          {[{ slug: undefined, name: "All" }, ...themes].map((t) => (
            <Link
              key={t.slug ?? "all"}
              href={href(1, sort, t.slug)}
              aria-current={theme === t.slug ? "page" : undefined}
              className={cn(
                "rounded-full border px-4 py-1.5 text-sm",
                theme === t.slug ? "border-navy-900 bg-navy-900 text-white" : "border-navy-900/15 bg-white text-navy-900",
              )}
            >
              {t.name}
            </Link>
          ))}
        </nav>
      )}

      <nav aria-label="Sort" className="mt-6 flex flex-wrap items-center gap-1 text-sm">
        <span className="mr-2 text-muted">Sort:</span>
        {SORTS.map((s) => (
          <Link
            key={s.value}
            href={href(1, s.value)}
            aria-current={sort === s.value ? "true" : undefined}
            className={cn("rounded-full px-3 py-1", sort === s.value ? "bg-gold-100 font-semibold text-navy-900" : "text-navy-900 hover:bg-navy-100")}
          >
            {s.label}
          </Link>
        ))}
      </nav>

      {videos.length === 0 ? (
        <p className="mt-12 text-muted">Our founding Fellows are recording now. The first stories arrive soon.</p>
      ) : (
        <ul className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {videos.map((v) => (
            <li key={v.id}>
              <VideoCardView video={v} />
            </li>
          ))}
        </ul>
      )}

      {pages > 1 && (
        <nav aria-label="Pages" className="mt-10 flex items-center justify-center gap-4 text-sm">
          {pageNumber > 1 && <Link href={href(pageNumber - 1)} className="underline">← Previous</Link>}
          <span className="text-muted">
            Page {pageNumber} of {pages}
          </span>
          {pageNumber < pages && <Link href={href(pageNumber + 1)} className="underline">Next →</Link>}
        </nav>
      )}
    </div>
  );
}
