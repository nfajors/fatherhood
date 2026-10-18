import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AddCollectionItemForm, CollectionDetailsForm, CollectionItemRow, DeleteCollectionButton } from "@/components/admin/collection-editor";
import { Card } from "@/components/ui/card";
import { adminCollectionItems, collectionOptions } from "@/lib/collections/service";
import { getDb } from "@/lib/db";
import { collections } from "@/lib/db/schema";

export const metadata: Metadata = { title: "Edit collection (admin)", robots: { index: false } };

export default async function AdminCollectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const db = getDb();
  const [collection] = await db.select().from(collections).where(eq(collections.id, id));
  if (!collection) notFound();
  const [items, options] = await Promise.all([adminCollectionItems(db, id), collectionOptions(db)]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <Link href="/admin/collections" className="text-sm text-muted underline">
        ← All collections
      </Link>
      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-3xl font-semibold">{collection.title}</h1>
        <Link href={`/collections/${collection.slug}`} className="text-sm underline">
          View /collections/{collection.slug}
        </Link>
      </div>

      <Card className="mt-6">
        <CollectionDetailsForm collection={collection} />
      </Card>

      <h2 className="mt-10 text-xl font-semibold">In this collection</h2>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Nothing yet. Add courses and Community videos below, in the order to watch them.</p>
      ) : (
        <ol className="mt-3 divide-y divide-navy-900/10 rounded-xl border border-navy-900/10 bg-white">
          {items.map((item, i) => (
            <CollectionItemRow
              key={item.id}
              first={i === 0}
              last={i === items.length - 1}
              item={{
                id: item.id,
                kind: item.courseId ? "Course" : "Video",
                label: item.courseTitle ?? item.videoTitle ?? "(deleted)",
                note: item.note,
                warning: item.courseId
                  ? item.coursePublished
                    ? null
                    : "Hidden from visitors until the course is published."
                  : item.videoStatus === "approved"
                    ? null
                    : "Hidden from visitors: this video isn't published.",
              }}
            />
          ))}
        </ol>
      )}
      <Card className="mt-4">
        <AddCollectionItemForm collectionId={id} courses={options.courses} videos={options.videos} />
      </Card>
      <div className="mt-10 border-t border-navy-900/10 pt-6">
        <DeleteCollectionButton collectionId={id} title={collection.title} />
      </div>
    </div>
  );
}
