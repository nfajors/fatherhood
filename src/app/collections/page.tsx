import type { Metadata } from "next";
import { CollectionShelf } from "@/components/collections/shelf";
import { getSessionUser } from "@/lib/auth";
import { publishedCollections } from "@/lib/collections/service";
import { getDb } from "@/lib/db";

export const metadata: Metadata = {
  title: "Collections",
  description: "Hand-picked paths through Fatherhood.School's courses and stories.",
};
export const dynamic = "force-dynamic";

export default async function CollectionsPage() {
  const sessionUser = await getSessionUser().catch(() => null);
  const shelves = await publishedCollections(getDb(), { preview: 8, userId: sessionUser?.id ?? null });
  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <h1 className="text-4xl font-semibold">Collections</h1>
      <p className="mt-4 max-w-2xl text-lg text-muted">Hand-picked paths through our courses and stories, for where you are right now.</p>
      {shelves.length === 0 ? (
        <p className="mt-10 text-muted">Our first collections are on their way.</p>
      ) : (
        <div className="mt-12 space-y-14">
          {shelves.map((s) => (
            <CollectionShelf key={s.collection.id} collection={s.collection} entries={s.entries} total={s.total} />
          ))}
        </div>
      )}
    </div>
  );
}
