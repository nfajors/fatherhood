"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { CATEGORIES } from "@/lib/config";
import { ErrorText, useApiAction } from "@/components/use-api-action";

const field = "mt-1 block w-full rounded-md border border-navy-900/20 bg-white px-3 py-2";

export type VideoOption = { id: string; title: string; durationSeconds: number | null };

export function CreateCourseForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const res = await fetch("/api/admin/courses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: new FormData(event.currentTarget).get("title") }),
    });
    const data = (await res.json().catch(() => ({}))) as { course?: { id: string }; message?: string };
    setPending(false);
    if (data.course) router.push(`/admin/courses/${data.course.id}`);
    else setError(data.message ?? "Could not create the course.");
  }
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <label className="block min-w-64 flex-1 text-sm font-medium">
        New course title
        <input name="title" required minLength={3} maxLength={140} className={field} />
      </label>
      <Button type="submit" disabled={pending}>
        Create draft
      </Button>
      <ErrorText error={error} />
    </form>
  );
}

type CourseFields = {
  id: string;
  title: string;
  slug: string;
  subtitle: string | null;
  description: string | null;
  category: string | null;
  coverImageUrl: string | null;
  bookChapter: string | null;
  instructorId: string | null;
  sortOrder: number;
  published: boolean;
};

export function CourseDetailsForm({ course, instructors }: { course: CourseFields; instructors: { id: string; name: string }[] }) {
  const { pending, error, run } = useApiAction();
  const [saved, setSaved] = useState(false);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const text = (k: string) => String(f.get(k) ?? "");
    run(
      `/api/admin/courses/${course.id}`,
      "PATCH",
      {
        title: text("title"),
        slug: text("slug"),
        subtitle: text("subtitle"),
        description: text("description"),
        category: text("category") || null,
        coverImageUrl: text("coverImageUrl"),
        bookChapter: text("bookChapter"),
        instructorId: text("instructorId") || null,
        sortOrder: Number(text("sortOrder") || 0),
      },
      () => setSaved(true),
    );
  }
  return (
    <form onSubmit={submit} onChange={() => setSaved(false)} className="grid gap-4 sm:grid-cols-2">
      <label className="block text-sm font-medium sm:col-span-2">
        Title
        <input name="title" defaultValue={course.title} required minLength={3} maxLength={140} className={field} />
      </label>
      <label className="block text-sm font-medium">
        Address (/academy/…)
        <input name="slug" defaultValue={course.slug} required maxLength={60} className={field} />
      </label>
      <label className="block text-sm font-medium">
        Category
        <select name="category" defaultValue={course.category ?? ""} className={field}>
          <option value="">None</option>
          {CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <label className="block text-sm font-medium sm:col-span-2">
        Subtitle
        <input name="subtitle" defaultValue={course.subtitle ?? ""} maxLength={200} className={field} />
      </label>
      <label className="block text-sm font-medium sm:col-span-2">
        Description
        <textarea name="description" defaultValue={course.description ?? ""} rows={5} maxLength={5000} className={field} />
      </label>
      <label className="block text-sm font-medium">
        Instructor
        <select name="instructorId" defaultValue={course.instructorId ?? ""} className={field}>
          <option value="">None</option>
          {instructors.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm font-medium">
        Book chapter (optional)
        <input name="bookChapter" defaultValue={course.bookChapter ?? ""} maxLength={200} placeholder="e.g. Chapter 4: Why Fathers Matter" className={field} />
      </label>
      <label className="block text-sm font-medium">
        Cover image URL (optional)
        <input name="coverImageUrl" type="url" defaultValue={course.coverImageUrl ?? ""} maxLength={500} className={field} />
      </label>
      <label className="block text-sm font-medium">
        Sort order (lower shows first)
        <input name="sortOrder" type="number" min={0} defaultValue={course.sortOrder} className={field} />
      </label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={pending}>
          Save details
        </Button>
        {saved && <span className="text-sm text-muted">Saved.</span>}
      </div>
      <div className="sm:col-span-2">
        <ErrorText error={error} />
      </div>
    </form>
  );
}

export function PublishToggle({ courseId, published }: { courseId: string; published: boolean }) {
  const { pending, error, run } = useApiAction();
  return (
    <div>
      <Button
        variant={published ? "outline" : "primary"}
        disabled={pending}
        onClick={() => run(`/api/admin/courses/${courseId}`, "PATCH", { published: !published })}
      >
        {published ? "Unpublish" : "Publish course"}
      </Button>
      <ErrorText error={error} />
    </div>
  );
}

export function AddModuleForm({ courseId }: { courseId: string }) {
  const { pending, error, run } = useApiAction();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    run(`/api/admin/courses/${courseId}/modules`, "POST", { title: new FormData(formEl).get("title") }, () => formEl.reset());
  }
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <label className="block min-w-64 flex-1 text-sm font-medium">
        New module
        <input name="title" required maxLength={140} placeholder="e.g. The research" className={field} />
      </label>
      <Button type="submit" variant="secondary" disabled={pending}>
        Add module
      </Button>
      <ErrorText error={error} />
    </form>
  );
}

export function ModuleControls({ moduleId, title, first, last }: { moduleId: string; title: string; first: boolean; last: boolean }) {
  const { pending, error, run } = useApiAction();
  const url = `/api/admin/courses/modules/${moduleId}`;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Button size="sm" variant="ghost" disabled={pending || first} onClick={() => run(url, "PATCH", { move: "up" })} aria-label={`Move ${title} up`}>
        ↑
      </Button>
      <Button size="sm" variant="ghost" disabled={pending || last} onClick={() => run(url, "PATCH", { move: "down" })} aria-label={`Move ${title} down`}>
        ↓
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => {
          const next = window.prompt("Rename module", title);
          if (next && next.trim() && next !== title) run(url, "PATCH", { title: next });
        }}
      >
        Rename
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => {
          if (window.confirm(`Delete "${title}" and its lessons? The videos themselves are kept.`)) run(url, "DELETE");
        }}
      >
        Delete
      </Button>
      <ErrorText error={error} />
    </div>
  );
}

function VideoSelect({ name, videos, defaultValue }: { name: string; videos: VideoOption[]; defaultValue?: string | null }) {
  return (
    <select name={name} defaultValue={defaultValue ?? ""} className={field}>
      <option value="">No video yet</option>
      {videos.map((v) => (
        <option key={v.id} value={v.id}>
          {v.title}
          {v.durationSeconds ? ` (${Math.round(v.durationSeconds / 60)} min)` : ""}
        </option>
      ))}
    </select>
  );
}

export function AddLessonForm({ moduleId, videos }: { moduleId: string; videos: VideoOption[] }) {
  const { pending, error, run } = useApiAction();
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        + Add lesson
      </Button>
    );
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    run(
      `/api/admin/courses/modules/${moduleId}/lessons`,
      "POST",
      { title: f.get("title"), summary: String(f.get("summary") ?? ""), videoId: f.get("videoId") || null, isPreview: f.get("isPreview") === "on" },
      () => setOpen(false),
    );
  }
  return (
    <form onSubmit={submit} className="grid gap-3 rounded-lg border border-navy-900/10 bg-paper p-4 sm:grid-cols-2">
      <label className="block text-sm font-medium">
        Lesson title
        <input name="title" required maxLength={140} className={field} />
      </label>
      <label className="block text-sm font-medium">
        Video
        <VideoSelect name="videoId" videos={videos} />
      </label>
      <label className="block text-sm font-medium sm:col-span-2">
        Summary (optional)
        <textarea name="summary" rows={2} maxLength={1000} className={field} />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isPreview" /> Free preview (anyone can watch)
      </label>
      <div className="flex gap-2 sm:justify-end">
        <Button size="sm" type="submit" disabled={pending}>
          Add lesson
        </Button>
        <Button size="sm" variant="ghost" type="button" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      <div className="sm:col-span-2">
        <ErrorText error={error} />
      </div>
    </form>
  );
}

export function LessonRow({
  lesson,
  videos,
  quiz,
  courseId,
  first,
  last,
}: {
  lesson: { id: string; title: string; summary: string | null; videoId: string | null; isPreview: boolean; videoTitle: string | null; videoStatus: string | null };
  videos: VideoOption[];
  /** The lesson's quiz, if it has one. */
  quiz: { questions: number; published: boolean } | null;
  courseId: string;
  first: boolean;
  last: boolean;
}) {
  const { pending, error, run } = useApiAction();
  const [editing, setEditing] = useState(false);
  const url = `/api/admin/courses/lessons/${lesson.id}`;
  const options = lesson.videoId && !videos.some((v) => v.id === lesson.videoId)
    ? [{ id: lesson.videoId, title: `${lesson.videoTitle ?? "Current video"} (${lesson.videoStatus ?? "unavailable"})`, durationSeconds: null }, ...videos]
    : videos;

  if (editing) {
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const f = new FormData(event.currentTarget);
          run(url, "PATCH", { title: f.get("title"), summary: String(f.get("summary") ?? ""), videoId: f.get("videoId") || null, isPreview: f.get("isPreview") === "on" }, () =>
            setEditing(false),
          );
        }}
        className="grid gap-3 p-4 sm:grid-cols-2"
      >
        <label className="block text-sm font-medium">
          Title
          <input name="title" defaultValue={lesson.title} required maxLength={140} className={field} />
        </label>
        <label className="block text-sm font-medium">
          Video
          <VideoSelect name="videoId" videos={options} defaultValue={lesson.videoId} />
        </label>
        <label className="block text-sm font-medium sm:col-span-2">
          Summary
          <textarea name="summary" defaultValue={lesson.summary ?? ""} rows={2} maxLength={1000} className={field} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="isPreview" defaultChecked={lesson.isPreview} /> Free preview
        </label>
        <div className="flex gap-2 sm:justify-end">
          <Button size="sm" type="submit" disabled={pending}>
            Save
          </Button>
          <Button size="sm" variant="ghost" type="button" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
        <div className="sm:col-span-2">
          <ErrorText error={error} />
        </div>
      </form>
    );
  }

  const ready = lesson.videoStatus === "approved";
  return (
    <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="font-medium text-navy-900">
          {lesson.title}
          {lesson.isPreview && <span className="ml-2 rounded bg-gold-100 px-1.5 py-0.5 text-xs text-gold-600">Free preview</span>}
        </p>
        <p className={`text-sm ${ready ? "text-muted" : "text-amber-800"}`}>
          {lesson.videoId ? `${lesson.videoTitle}${ready ? "" : ` (${lesson.videoStatus?.replace("_", " ") ?? "unavailable"})`}` : "No video attached"}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <Link href={`/admin/courses/${courseId}/lessons/${lesson.id}/quiz`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
          {quiz && quiz.questions > 0
            ? `Quiz: ${quiz.questions} question${quiz.questions === 1 ? "" : "s"}${quiz.published ? "" : " (draft)"}`
            : "Add quiz"}
        </Link>
        <Button size="sm" variant="ghost" disabled={pending || first} onClick={() => run(url, "PATCH", { move: "up" })} aria-label={`Move ${lesson.title} up`}>
          ↑
        </Button>
        <Button size="sm" variant="ghost" disabled={pending || last} onClick={() => run(url, "PATCH", { move: "down" })} aria-label={`Move ${lesson.title} down`}>
          ↓
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
          Edit
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            if (window.confirm(`Delete the lesson "${lesson.title}"? Its video is kept.`)) run(url, "DELETE");
          }}
        >
          Delete
        </Button>
      </div>
      <ErrorText error={error} />
    </div>
  );
}
