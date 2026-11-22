import Link from "next/link";
import type { getPath } from "@/lib/coach/path";

type Path = NonNullable<Awaited<ReturnType<typeof getPath>>>;

const KIND = { lesson: "Lesson", course: "Course", community: "Community Voices" } as const;

/** The member's path as a checklist; each step says why it's there, and done steps show it with an icon and words. */
export function PathSteps({ path, compact = false }: { path: Path; compact?: boolean }) {
  const doneCount = path.steps.filter((s) => s.done).length;
  return (
    <div>
      <p className={compact ? "text-sm text-muted" : "text-muted"}>{path.summary}</p>
      <p className="mt-2 text-sm font-semibold">
        {doneCount} of {path.steps.length} done
      </p>
      <ol className="mt-3 space-y-2">
        {path.steps.map((s, i) => (
          <li key={`${s.kind}:${s.id}`} className="flex gap-3">
            <span
              aria-hidden
              className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${s.done ? "bg-emerald-100 text-emerald-900" : "bg-navy-100 text-navy-900"}`}
            >
              {s.done ? "✓" : i + 1}
            </span>
            <span className="min-w-0">
              <span className="sr-only">{s.done ? "Done: " : "To do: "}</span>
              <Link href={s.path} className="font-medium hover:underline">
                {s.title}
              </Link>
              <span className="ml-2 text-xs text-muted">{KIND[s.kind]}</span>
              {!compact && <span className="block text-sm text-muted">{s.why}</span>}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
