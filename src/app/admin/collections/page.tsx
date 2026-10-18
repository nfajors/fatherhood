import type { Metadata } from "next";
import Link from "next/link";
import { CreateCollectionForm } from "@/components/admin/collection-editor";
import { Card } from "@/components/ui/card";
import { adminCollections } from "@/lib/collections/service";
import { getDb } from "@/lib/db";

export const metadata: Metadata = { title: "Collections (admin)", robots: { index: false } };

export default async function AdminCollectionsPage() {
  const rows = await adminCollections(getDb());
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-semibold">Collections</h1>
      <p className="mt-2 text-muted">
        Hand-picked paths such as &quot;Start Here&quot; or &quot;Book Companion&quot;. Featured collections show at the top of the Academy and
        Community Voices; all published ones are at /collections.
      </p>
      <Card className="mt-6">
        <CreateCollectionForm />
      </Card>
      {rows.length > 0 && (
        <ul className="mt-6 divide-y divide-navy-900/10 rounded-xl border border-navy-900/10 bg-white">
          {rows.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <Link href={`/admin/collections/${c.id}`} className="font-medium underline-offset-2 hover:underline">
                {c.title}
              </Link>
              <span className="flex gap-2 text-xs">
                <span className="text-muted">{c.items} items</span>
                {c.featured && <span className="rounded bg-gold-100 px-1.5 font-semibold text-gold-600">Featured</span>}
                <span className={c.published ? "rounded bg-emerald-100 px-1.5 text-emerald-900" : "rounded bg-navy-100 px-1.5"}>{c.published ? "Published" : "Draft"}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
