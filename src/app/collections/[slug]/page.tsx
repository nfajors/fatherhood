import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EntryCard } from "@/components/collections/shelf";
import { getAdminUser, getSessionUser } from "@/lib/auth";
import { getCollection } from "@/lib/collections/service";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const found = await getCollection(getDb(), slug);
  return found ? { title: found.collection.title, description: found.collection.description ?? undefined } : {};
}

export default async function CollectionPage({ params }: Params) {
  const { slug } = await params;
  const [sessionUser, admin] = await Promise.all([getSessionUser().catch(() => null), getAdminUser().catch(() => null)]);
  const found = await getCollection(getDb(), slug, { userId: sessionUser?.id ?? null, includeUnpublished: Boolean(admin) });
  if (!found) notFound();
  const { collection, entries } = found;

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
      <Link href="/collections" className="text-sm text-muted underline">
        ← All collections
      </Link>
      {!collection.published && (
        <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">Draft: only admins can see this collection.</p>
      )}
      <h1 className="mt-4 text-4xl font-semibold">{collection.title}</h1>
      {collection.description && <p className="mt-4 max-w-2xl text-lg text-muted">{collection.description}</p>}
      {entries.length === 0 ? (
        <p className="mt-10 text-muted">Nothing here yet.</p>
      ) : (
        <ol className="mt-10 space-y-8">
          {entries.map((e, i) => (
            <li key={e.itemId} className="grid gap-4 sm:grid-cols-[3rem_1fr]">
              <span aria-hidden className="font-serif text-3xl text-gold-600">
                {i + 1}
              </span>
              <div>
                {e.note && <p className="mb-3 text-ink">{e.note}</p>}
                <div className="max-w-md">
                  <EntryCard entry={e} />
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
