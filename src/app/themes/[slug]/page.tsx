import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { getDb } from "@/lib/db";
import { themes } from "@/lib/db/schema";
import { publicThemeContent } from "@/lib/themes/service";

export const dynamic = "force-dynamic";

async function loadTheme(slug: string) {
  return getDb().query.themes.findFirst({ where: and(eq(themes.slug, slug), eq(themes.status, "active")) });
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const theme = await loadTheme((await params).slug);
  return theme ? { title: theme.name, description: theme.description } : {};
}

function minutes(seconds: number | null): string | null {
  return seconds ? `${Math.max(1, Math.round(seconds / 60))} min` : null;
}

export default async function ThemePage({ params }: { params: Promise<{ slug: string }> }) {
  const theme = await loadTheme((await params).slug);
  if (!theme) notFound();
  const { videos, courses } = await publicThemeContent(getDb(), theme.id);
  const empty = videos.length === 0 && courses.length === 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <Link href="/themes" className="text-sm text-muted underline">
        ← All themes
      </Link>
      <h1 className="mt-3 text-4xl font-semibold">{theme.name}</h1>
      <p className="mt-4 max-w-2xl text-lg text-muted">{theme.description}</p>

      {empty && <p className="mt-10 text-muted">Courses and stories on this theme are on the way.</p>}

      {courses.length > 0 && (
        <section className="mt-12" aria-labelledby="courses">
          <h2 id="courses" className="text-2xl font-semibold">Courses</h2>
          <ul className="mt-5 grid gap-5 sm:grid-cols-2">
            {courses.map((c) => (
              <li key={c.id}>
                <Card>
                  <CardTitle>{c.title}</CardTitle>
                  {c.subtitle && <CardDescription>{c.subtitle}</CardDescription>}
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}

      {videos.length > 0 && (
        <section className="mt-12" aria-labelledby="videos">
          <h2 id="videos" className="text-2xl font-semibold">Videos</h2>
          <ul className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {videos.map((v) => (
              <li key={v.id}>
                <Card className="p-0">
                  {v.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- Stream thumbnails are already sized
                    <img src={v.thumbnailUrl} alt="" className="aspect-video w-full rounded-t-xl object-cover" />
                  ) : (
                    <div className="aspect-video w-full rounded-t-xl bg-navy-100" />
                  )}
                  <div className="p-5">
                    <p className="font-semibold text-navy-900">{v.title}</p>
                    <p className="mt-1 text-sm text-muted">
                      {[v.type === "community" ? "Community Voices" : "Academy", minutes(v.durationSeconds)].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
