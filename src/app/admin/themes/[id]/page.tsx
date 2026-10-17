import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ClassifyButton, RemovePlacementButton, RestorePlacementButton } from "@/components/admin/theme-actions";
import { getAdminUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { themes } from "@/lib/db/schema";
import { themeClassifierConfigured } from "@/lib/env";
import { adminThemeContent } from "@/lib/themes/service";

export const metadata: Metadata = { title: "Theme (admin)", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function AdminThemePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await getAdminUser()) || !z.uuid().safeParse(id).success) notFound();
  const db = getDb();
  const theme = await db.query.themes.findFirst({ where: eq(themes.id, id) });
  if (!theme) notFound();
  const placements = await adminThemeContent(db, id);
  const classifierOn = themeClassifierConfigured();

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <Link href="/admin/themes" className="text-sm text-muted underline">
        ← All themes
      </Link>
      <h1 className="mt-3 text-3xl font-semibold">{theme.name}</h1>
      <p className="mt-2 text-muted">
        {theme.status} · {theme.description}
      </p>

      <h2 className="mt-10 text-xl font-semibold">Content ({placements.filter((p) => p.status === "active").length})</h2>
      {placements.length === 0 ? (
        <p className="mt-3 text-muted">Nothing placed here yet.</p>
      ) : (
        <ul className="mt-4 divide-y divide-navy-900/10 rounded-xl border border-navy-900/10 bg-white">
          {placements.map((p) => {
            const target = p.videoId ? { kind: "video" as const, id: p.videoId } : { kind: "course" as const, id: p.courseId! };
            const removed = p.status === "rejected";
            return (
              <li key={p.assignmentId} className={`flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between ${removed ? "opacity-60" : ""}`}>
                <div className="min-w-0">
                  <p className="font-medium text-navy-900">
                    {p.title}
                    {p.isPrimary && !removed && <span className="ml-2 rounded bg-gold-100 px-1.5 py-0.5 text-xs text-gold-600">Primary</span>}
                  </p>
                  <p className="text-sm text-muted">
                    {target.kind} · {p.contentStatus} ·{" "}
                    {removed ? "removed by admin" : p.source === "ai" ? `AI, ${p.confidence}% confident` : "placed by admin"}
                  </p>
                  {p.rationale && !removed && <p className="mt-1 text-sm text-ink">{p.rationale}</p>}
                </div>
                <div className="flex shrink-0 gap-1">
                  {removed ? (
                    <RestorePlacementButton themeId={id} target={target} />
                  ) : (
                    <RemovePlacementButton themeId={id} target={target} />
                  )}
                  {classifierOn && <ClassifyButton target={target} label="Re-run AI" />}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
