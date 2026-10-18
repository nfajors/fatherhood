import { asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AddLessonForm, AddModuleForm, CourseDetailsForm, LessonRow, ModuleControls, PublishToggle } from "@/components/admin/course-builder";
import { LessonResources } from "@/components/admin/lesson-resources";
import { Card } from "@/components/ui/card";
import { instructorOptions, lessonVideoOptions } from "@/lib/courses/admin";
import { getDb } from "@/lib/db";
import { courseModules, courses, lessonResources, lessons, videos } from "@/lib/db/schema";

export const metadata: Metadata = { title: "Edit course (admin)", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function AdminCoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const db = getDb();
  const course = await db.query.courses.findFirst({ where: eq(courses.id, id) });
  if (!course) notFound();

  const [modules, lessonRows, videoOptions, instructors] = await Promise.all([
    db.select().from(courseModules).where(eq(courseModules.courseId, id)).orderBy(asc(courseModules.position)),
    db
      .select({
        id: lessons.id,
        moduleId: lessons.moduleId,
        title: lessons.title,
        summary: lessons.summary,
        videoId: lessons.videoId,
        isPreview: lessons.isPreview,
        videoTitle: videos.title,
        videoStatus: videos.status,
      })
      .from(lessons)
      .innerJoin(courseModules, eq(lessons.moduleId, courseModules.id))
      .leftJoin(videos, eq(lessons.videoId, videos.id))
      .where(eq(courseModules.courseId, id))
      .orderBy(asc(lessons.position)),
    lessonVideoOptions(db),
    instructorOptions(db),
  ]);
  const resources = await db
    .select({
      id: lessonResources.id,
      lessonId: lessonResources.lessonId,
      title: lessonResources.title,
      kind: lessonResources.kind,
      fileName: lessonResources.fileName,
      sizeBytes: lessonResources.sizeBytes,
    })
    .from(lessonResources)
    .innerJoin(lessons, eq(lessonResources.lessonId, lessons.id))
    .innerJoin(courseModules, eq(lessons.moduleId, courseModules.id))
    .where(eq(courseModules.courseId, id))
    .orderBy(asc(lessonResources.position), asc(lessonResources.createdAt));

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <Link href="/admin/courses" className="text-sm text-muted underline">
        ← All courses
      </Link>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">{course.title}</h1>
          <p className="mt-1 text-sm text-muted">
            {course.published ? (
              <>
                Published at{" "}
                <Link href={`/academy/${course.slug}`} className="underline">
                  /academy/{course.slug}
                </Link>
              </>
            ) : (
              "Draft: not visible to members"
            )}
          </p>
        </div>
        <PublishToggle courseId={course.id} published={course.published} />
      </div>

      <section className="mt-10" aria-labelledby="outline">
        <h2 id="outline" className="text-2xl font-semibold">
          Modules and lessons
        </h2>
        {videoOptions.length === 0 && (
          <p className="mt-2 text-sm text-amber-800">
            No approved professional videos yet. Upload lesson videos and approve them in Moderation, then attach them here.
          </p>
        )}
        <ol className="mt-4 space-y-6">
          {modules.map((mod, mi) => {
            const modLessons = lessonRows.filter((l) => l.moduleId === mod.id);
            return (
              <li key={mod.id}>
                <Card className="p-0">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-navy-900/10 p-4">
                    <h3 className="font-semibold">
                      Module {mi + 1}: {mod.title}
                    </h3>
                    <ModuleControls moduleId={mod.id} title={mod.title} first={mi === 0} last={mi === modules.length - 1} />
                  </div>
                  <ol className="divide-y divide-navy-900/10">
                    {modLessons.map((lesson, li) => (
                      <li key={lesson.id}>
                        <LessonRow lesson={lesson} videos={videoOptions} first={li === 0} last={li === modLessons.length - 1} />
                        <LessonResources lessonId={lesson.id} resources={resources.filter((r) => r.lessonId === lesson.id)} />
                      </li>
                    ))}
                  </ol>
                  <div className="p-4">
                    <AddLessonForm moduleId={mod.id} videos={videoOptions} />
                  </div>
                </Card>
              </li>
            );
          })}
        </ol>
        <Card className="mt-6">
          <AddModuleForm courseId={course.id} />
        </Card>
      </section>

      <section className="mt-12" aria-labelledby="details">
        <h2 id="details" className="text-2xl font-semibold">
          Course details
        </h2>
        <Card className="mt-4">
          <CourseDetailsForm course={course} instructors={instructors} />
        </Card>
      </section>
    </div>
  );
}
