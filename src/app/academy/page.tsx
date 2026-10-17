import type { Metadata } from "next";
import { CATEGORIES } from "@/lib/config";

export const metadata: Metadata = { title: "Professional Academy" };

export default function AcademyPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <h1 className="text-4xl font-semibold">Professional Academy</h1>
      <p className="mt-4 max-w-2xl text-lg text-muted">
        Structured courses for every stage of fatherhood. The first courses open with the launch of the book.
      </p>
      <ul className="mt-10 flex flex-wrap gap-2" aria-label="Categories">
        {CATEGORIES.map((c) => (
          <li key={c} className="rounded-full border border-navy-900/15 bg-white px-4 py-1.5 text-sm text-navy-900">
            {c}
          </li>
        ))}
      </ul>
    </div>
  );
}
