import type { Metadata } from "next";
import Link from "next/link";
import { VideoCardView } from "@/components/catalog/cards";
import { communityThemes, listCommunityVideos } from "@/lib/courses/catalog";
import { getDb } from "@/lib/db";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Community Voices",
  description: "Short, honest videos from fathers: stories, lessons and what they wish they had known. Free for everyone.",
};
export const dynamic = "force-dynamic";

const PAGE_SIZE = 24;

export default async function CommunityPage({ searchParams }: { searchParams: Promise<{ theme?: string; page?: string }> }) {
  const { theme, page } = await searchParams;
  const pageNumber = Math.max(1, Number.parseInt(page ?? "1", 10) || 1);
  const db = getDb();
  const [{ videos, total }, themes] = await Promise.all([
    listCommunityVideos(db, { themeSlug: theme, limit: PAGE_SIZE, offset: (pageNumber - 1) * PAGE_SIZE }),
    communityThemes(db),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (p: number) => `/community?${new URLSearchParams({ ...(theme ? { theme } : {}), ...(p > 1 ? { page: String(p) } : {}) })}`;

  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <h1 className="text-4xl font-semibold">Community Voices</h1>
      <p className="mt-4 max-w-2xl text-lg text-muted">
        Short stories and practical lessons from fathers who have walked the road. Free for everyone.{" "}
        <Link href="/fellows" className="whitespace-nowrap text-navy-900 underline underline-offset-2">
          Share yours
        </Link>
      </p>

      {themes.length > 0 && (
        <nav aria-label="Themes" className="mt-8 flex flex-wrap gap-2">
          {[{ slug: undefined, name: "All" }, ...themes].map((t) => (
            <Link
              key={t.slug ?? "all"}
              href={t.slug ? `/community?theme=${t.slug}` : "/community"}
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
          {pageNumber > 1 && <Link href={href(pageNumber - 1)} className="underline">← Newer</Link>}
          <span className="text-muted">
            Page {pageNumber} of {pages}
          </span>
          {pageNumber < pages && <Link href={href(pageNumber + 1)} className="underline">Older →</Link>}
        </nav>
      )}
    </div>
  );
}
