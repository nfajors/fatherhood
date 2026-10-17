import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SITE } from "@/lib/config";

export const metadata: Metadata = { title: SITE.bookTitle };

export default function BookPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <p className="text-sm font-semibold uppercase tracking-widest text-gold-600">The book</p>
      <h1 className="mt-3 text-4xl font-semibold sm:text-5xl">{SITE.bookTitle}</h1>
      <p className="mt-6 text-lg text-muted">
        Fatherhood.School launches alongside the book. Readers get companion courses that expand on its case
        studies, author notes and excerpts, and early access to new releases.
      </p>
      <p className="mt-4 text-muted">Excerpts, companion videos and reader codes will be published here at launch.</p>
      <Button asChild className="mt-8">
        <Link href="/pricing">See membership</Link>
      </Button>
    </div>
  );
}
