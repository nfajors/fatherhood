import type { Metadata } from "next";
import Link from "next/link";
import { CourseCardView } from "@/components/catalog/cards";
import { getSessionUser } from "@/lib/auth";
import { CATEGORIES } from "@/lib/config";
import { listPublishedCourses } from "@/lib/courses/catalog";
import { getDb } from "@/lib/db";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Professional Academy",
  description: "Structured video courses for every stage of fatherhood, from the author of Fatherhood in Focus and leading experts.",
};
export const dynamic = "force-dynamic";

export default async function AcademyPage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  const { category } = await searchParams;
  const sessionUser = await getSessionUser().catch(() => null);
  const all = await listPublishedCourses(getDb(), sessionUser?.id ?? null);
  const courses = category ? all.filter((c) => c.category === category) : all;
  const usedCategories = CATEGORIES.filter((c) => all.some((course) => course.category === c));

  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <h1 className="text-4xl font-semibold">Professional Academy</h1>
      <p className="mt-4 max-w-2xl text-lg text-muted">
        Structured courses for every stage of fatherhood. Lessons run 8 to 20 minutes, with workbooks and reflection
        exercises. Free preview lessons are open to everyone.
      </p>

      {usedCategories.length > 1 && (
        <nav aria-label="Categories" className="mt-8 flex flex-wrap gap-2">
          {[undefined, ...usedCategories].map((c) => (
            <Link
              key={c ?? "all"}
              href={c ? `/academy?category=${encodeURIComponent(c)}` : "/academy"}
              aria-current={category === c ? "page" : undefined}
              className={cn(
                "rounded-full border px-4 py-1.5 text-sm",
                category === c ? "border-navy-900 bg-navy-900 text-white" : "border-navy-900/15 bg-white text-navy-900",
              )}
            >
              {c ?? "All courses"}
            </Link>
          ))}
        </nav>
      )}

      {courses.length === 0 ? (
        <p className="mt-12 text-muted">The first courses open with the launch of the book. Check back soon.</p>
      ) : (
        <ul className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((course) => (
            <li key={course.id}>
              <CourseCardView course={course} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
