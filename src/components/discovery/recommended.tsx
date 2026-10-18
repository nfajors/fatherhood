import { CourseCardView, VideoCardView } from "@/components/catalog/cards";
import type { CommunityCard, CourseCard } from "@/lib/courses/catalog";
import type { Recommended } from "@/lib/discovery/recommend";

/** "Recommended for you" (or "Popular with fathers" before we know someone's taste). */
export function RecommendedSection({
  recs,
  id = "for-you",
}: {
  recs: { personalized: boolean; videos: Recommended<CommunityCard>[]; courses: Recommended<CourseCard>[] };
  id?: string;
}) {
  if (recs.videos.length === 0 && recs.courses.length === 0) return null;
  const why = (reason: string | null) =>
    reason ? <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-gold-600">More on {reason}</p> : null;
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="text-2xl font-semibold">
        {recs.personalized ? "Recommended for you" : "Popular with fathers"}
      </h2>
      <p className="mt-1 text-sm text-muted">
        {recs.personalized ? "Based on what you've watched and rated." : "What fathers are watching most right now."}
      </p>
      <ul className="mt-5 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {recs.courses.map((c) => (
          <li key={c.id}>
            {why(c.reason)}
            <CourseCardView course={c} />
          </li>
        ))}
        {recs.videos.map((v) => (
          <li key={v.id}>
            {why(v.reason)}
            <VideoCardView video={v} />
          </li>
        ))}
      </ul>
    </section>
  );
}
