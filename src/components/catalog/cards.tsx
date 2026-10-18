import Link from "next/link";
import type { CommunityCard, CourseCard } from "@/lib/courses/catalog";
import { RatingBadge } from "@/components/ratings/stars";
import { formatDuration } from "@/lib/format";

export function ProgressBar({ percent, label }: { percent: number; label?: string }) {
  return (
    <div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-navy-100"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? "Progress"}
      >
        <div className="h-full rounded-full bg-gold-500" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export function CourseCardView({ course }: { course: CourseCard }) {
  const meta = [course.lessonCount ? `${course.lessonCount} ${course.lessonCount === 1 ? "lesson" : "lessons"}` : null, formatDuration(course.totalSeconds)]
    .filter(Boolean)
    .join(" · ");
  return (
    <Link href={`/academy/${course.slug}`} className="group relative block h-full overflow-hidden rounded-xl border border-navy-900/10 bg-white shadow-sm hover:border-gold-500">
      {course.coverImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- admin-provided cover URL
        <img src={course.coverImageUrl} alt="" className="aspect-[16/9] w-full object-cover" />
      ) : (
        <div className="flex aspect-[16/9] w-full items-end bg-navy-900 p-5">
          <span className="font-serif text-2xl leading-tight text-white">{course.title}</span>
        </div>
      )}
      <div className="p-5">
        {course.category && <p className="text-xs font-semibold uppercase tracking-widest text-gold-600">{course.category}</p>}
        <h3 className="mt-1 text-xl font-semibold group-hover:underline">{course.title}</h3>
        {course.subtitle && <p className="mt-1 text-muted">{course.subtitle}</p>}
        <p className="mt-3 text-sm text-muted">
          {[course.instructorName, meta].filter(Boolean).join(" · ")}
        </p>
        <RatingBadge average={course.ratingAverage} count={course.ratingCount} className="mt-2" />
        {course.percentComplete !== null && course.percentComplete > 0 && (
          <div className="mt-4">
            <ProgressBar percent={course.percentComplete} label={`${course.title} progress`} />
            <p className="mt-1 text-xs text-muted">{course.percentComplete}% complete</p>
          </div>
        )}
      </div>
    </Link>
  );
}

export function VideoCardView({ video }: { video: CommunityCard }) {
  return (
    <Link href={`/community/${video.id}`} className="group relative block overflow-hidden rounded-xl border border-navy-900/10 bg-white shadow-sm hover:border-gold-500">
      <div className="relative">
        {video.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- Stream thumbnail
          <img src={video.thumbnailUrl} alt="" className="aspect-video w-full object-cover" />
        ) : (
          <div className="aspect-video w-full bg-navy-100" />
        )}
        {video.durationSeconds ? (
          <span className="absolute bottom-2 right-2 rounded bg-navy-950/80 px-1.5 py-0.5 text-xs text-white">{formatDuration(video.durationSeconds)}</span>
        ) : null}
      </div>
      <div className="p-4">
        <p className="font-semibold text-navy-900 group-hover:underline">{video.title}</p>
        <p className="mt-1 flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
          <span>{video.creatorName}</span>
          <RatingBadge average={video.ratingAverage} count={video.ratingCount} />
        </p>
      </div>
    </Link>
  );
}
