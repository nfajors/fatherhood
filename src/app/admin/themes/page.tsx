import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClassifyButton, NewThemeForm, ThemeEditForm, ThemeStatusButtons } from "@/components/admin/theme-actions";
import { Card } from "@/components/ui/card";
import { getAdminUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { themeClassifierConfigured } from "@/lib/env";
import { listThemesWithCounts, unthemedCounts } from "@/lib/themes/service";

export const metadata: Metadata = { title: "Themes (admin)", robots: { index: false } };
export const dynamic = "force-dynamic";

const items = (n: number) => `${n} ${n === 1 ? "item" : "items"}`;

const ORIGIN_LABEL = { book: "From the book", ai: "AI proposed", admin: "Added by admin" } as const;

export default async function AdminThemesPage() {
  if (!(await getAdminUser())) notFound();
  const db = getDb();
  const [all, unthemed] = await Promise.all([listThemesWithCounts(db), unthemedCounts(db)]);
  const proposed = all.filter((t) => t.status === "proposed");
  const active = all.filter((t) => t.status === "active");
  const archived = all.filter((t) => t.status === "archived");
  const mergeTargets = (excludeId: string) => active.filter((t) => t.id !== excludeId).map((t) => ({ id: t.id, name: t.name }));
  const nameById = new Map(all.map((t) => [t.id, t.name]));

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-semibold">Themes</h1>
      <p className="mt-2 max-w-2xl text-muted">
        The AI places every video and course in up to three themes and proposes a new theme when nothing fits.
        Proposed themes stay private until you approve them.
      </p>

      <Card className="mt-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-semibold text-navy-900">
            {unthemed.neverRun} not yet classified · {unthemed.noTheme} with no theme
          </p>
          <p className="text-sm text-muted">
            {themeClassifierConfigured()
              ? "New videos are classified automatically when they finish processing."
              : "Set ANTHROPIC_API_KEY to turn on the AI classifier."}
          </p>
        </div>
        {themeClassifierConfigured() && unthemed.neverRun > 0 && <ClassifyButton label="Classify next 10" />}
      </Card>

      <section className="mt-12" aria-labelledby="proposed">
        <h2 id="proposed" className="text-2xl font-semibold">
          Proposed by AI <span className="text-base font-normal text-muted">({proposed.length})</span>
        </h2>
        {proposed.length === 0 ? (
          <p className="mt-3 text-muted">No proposals waiting.</p>
        ) : (
          <ul className="mt-4 space-y-4">
            {proposed.map((t) => (
              <li key={t.id}>
                <Card>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <Link href={`/admin/themes/${t.id}`} className="font-serif text-xl font-semibold text-navy-900 underline-offset-4 hover:underline">
                      {t.name}
                    </Link>
                    <span className="text-sm text-muted">{items(t.contentCount)}</span>
                  </div>
                  <p className="mt-2 text-ink">{t.description}</p>
                  {t.proposalRationale && <p className="mt-1 text-sm text-muted">Why: {t.proposalRationale}</p>}
                  <div className="mt-4">
                    <ThemeStatusButtons themeId={t.id} status={t.status} mergeTargets={mergeTargets(t.id)} />
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-12" aria-labelledby="active">
        <h2 id="active" className="text-2xl font-semibold">
          Active <span className="text-base font-normal text-muted">({active.length})</span>
        </h2>
        <ul className="mt-4 divide-y divide-navy-900/10 rounded-xl border border-navy-900/10 bg-white">
          {active.map((t) => (
            <li key={t.id} className="p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link href={`/admin/themes/${t.id}`} className="font-semibold text-navy-900 underline-offset-4 hover:underline">
                  {t.name}
                </Link>
                <span className="text-sm text-muted">
                  {items(t.contentCount)} · {ORIGIN_LABEL[t.origin]}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted">{t.description}</p>
              <div className="mt-3 flex flex-wrap items-start gap-2">
                <ThemeEditForm themeId={t.id} name={t.name} description={t.description} />
                <ThemeStatusButtons themeId={t.id} status={t.status} mergeTargets={mergeTargets(t.id)} />
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-12 grid gap-8 md:grid-cols-2">
        <Card>
          <h2 className="text-xl font-semibold">Add a theme</h2>
          <div className="mt-4">
            <NewThemeForm />
          </div>
        </Card>
        {archived.length > 0 && (
          <Card>
            <h2 className="text-xl font-semibold">Archived</h2>
            <ul className="mt-4 space-y-3">
              {archived.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {t.name}
                    {t.mergedIntoId && <span className="text-sm text-muted"> → merged into {nameById.get(t.mergedIntoId)}</span>}
                  </span>
                  {!t.mergedIntoId && <ThemeStatusButtons themeId={t.id} status={t.status} mergeTargets={[]} />}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}
