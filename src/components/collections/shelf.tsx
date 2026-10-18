import Link from "next/link";
import { CourseCardView, VideoCardView } from "@/components/catalog/cards";
import type { CollectionEntry } from "@/lib/collections/service";

export function EntryCard({ entry }: { entry: CollectionEntry }) {
  return entry.kind === "course" ? <CourseCardView course={entry.course} /> : <VideoCardView video={entry.video} />;
}

/** A collection as a horizontal shelf of cards, with a link to the whole collection. */
export function CollectionShelf({
  collection,
  entries,
  total,
}: {
  collection: { slug: string; title: string; description: string | null };
  entries: CollectionEntry[];
  total: number;
}) {
  return (
    <section aria-labelledby={`collection-${collection.slug}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`collection-${collection.slug}`} className="text-2xl font-semibold">
          {collection.title}
        </h2>
        <Link href={`/collections/${collection.slug}`} className="text-sm font-semibold underline-offset-2 hover:underline">
          {total > entries.length ? `See all ${total} →` : "Open collection →"}
        </Link>
      </div>
      {collection.description && <p className="mt-1 max-w-2xl text-muted">{collection.description}</p>}
      <ul className="relative -mx-4 mt-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
        {entries.map((e) => (
          <li key={e.itemId} className="w-72 shrink-0 snap-start">
            <EntryCard entry={e} />
          </li>
        ))}
      </ul>
    </section>
  );
}
