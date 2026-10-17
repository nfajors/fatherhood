import { and, asc, eq, sql } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { getDb } from "@/lib/db";
import { themes } from "@/lib/db/schema";

export const metadata: Metadata = {
  title: "Themes",
  description: "Browse Fatherhood.School courses and Community Voices by theme.",
};
export const dynamic = "force-dynamic";

export default async function ThemesPage() {
  const rows = await getDb()
    .select({
      slug: themes.slug,
      name: themes.name,
      description: themes.description,
      count: sql<number>`(
        (select count(*)::int from theme_assignments a join videos v on v.id = a.video_id
          where a.theme_id = "themes"."id" and a.status = 'active' and v.status = 'approved')
        + (select count(*)::int from theme_assignments a join courses c on c.id = a.course_id
          where a.theme_id = "themes"."id" and a.status = 'active' and c.published))`,
    })
    .from(themes)
    .where(and(eq(themes.status, "active")))
    .orderBy(asc(themes.sortOrder), asc(themes.name));

  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <h1 className="text-4xl font-semibold">Themes</h1>
      <p className="mt-4 max-w-2xl text-lg text-muted">
        The big questions of fatherhood, from choosing a partner to leaving a legacy. Every course and story lives
        under the themes it speaks to.
      </p>
      <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((t) => (
          <li key={t.slug}>
            <Link href={`/themes/${t.slug}`} className="block h-full rounded-xl focus-visible:outline-offset-4">
              <Card className="h-full transition-colors hover:border-gold-500">
                <CardTitle>{t.name}</CardTitle>
                <CardDescription>{t.description}</CardDescription>
                <p className="mt-4 text-sm font-semibold text-gold-600">
                  {t.count === 0 ? "Coming soon" : `${t.count} ${t.count === 1 ? "item" : "items"}`}
                </p>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
