import type { Metadata } from "next";
import Link from "next/link";
import { CreateCourseForm } from "@/components/admin/course-builder";
import { Card } from "@/components/ui/card";
import { listAllCourses } from "@/lib/courses/admin";
import { getDb } from "@/lib/db";

export const metadata: Metadata = { title: "Courses (admin)", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function AdminCoursesPage() {
  const courses = await listAllCourses(getDb());
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-semibold">Courses</h1>
      <p className="mt-2 max-w-2xl text-muted">
        Build courses from approved professional videos. Drafts are private; publishing makes a course visible in the
        Academy and places it in themes.
      </p>
      <Card className="mt-8">
        <CreateCourseForm />
      </Card>
      {courses.length === 0 ? (
        <p className="mt-8 text-muted">No courses yet.</p>
      ) : (
        <ul className="mt-8 divide-y divide-navy-900/10 rounded-xl border border-navy-900/10 bg-white">
          {courses.map((c) => (
            <li key={c.id}>
              <Link href={`/admin/courses/${c.id}`} className="flex items-center justify-between gap-3 p-4 hover:bg-paper">
                <span>
                  <span className="font-semibold text-navy-900">{c.title}</span>
                  <span className="block text-sm text-muted">
                    /academy/{c.slug} · {c.lessonCount} {c.lessonCount === 1 ? "lesson" : "lessons"}
                  </span>
                </span>
                <span className={`rounded px-2 py-0.5 text-xs ${c.published ? "bg-emerald-100 text-emerald-900" : "bg-navy-100 text-navy-900"}`}>
                  {c.published ? "Published" : "Draft"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
