import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { PLANS, SITE } from "@/lib/config";

export default function HomePage() {
  return (
    <>
      <section className="bg-navy-950 text-white">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
          <p className="text-sm font-semibold uppercase tracking-widest text-gold-400">An academy for fathers</p>
          <h1 className="mt-4 max-w-3xl text-4xl font-semibold text-white sm:text-6xl">
            Become the father your children need.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-white/75">
            Rigorous, practical video courses grounded in research and lived experience, from the author of{" "}
            <em>{SITE.bookTitle}</em> and fathers who have walked the road.
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href="/pricing">Join for ${PLANS.annual.amountCents / 100}/year</Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10">
              <Link href="/community">Watch free stories</Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-6 px-4 py-16 sm:px-6 md:grid-cols-3">
        <Card>
          <CardTitle>Professional Academy</CardTitle>
          <CardDescription>
            Structured courses with workbooks and reflection exercises. Lessons of 8 to 20 minutes you can finish
            between bedtime and lights out.
          </CardDescription>
        </Card>
        <Card>
          <CardTitle>Community Voices</CardTitle>
          <CardDescription>
            Short, honest videos from approved fathers: what they wish they had known, and what they are learning
            now. Free for everyone.
          </CardDescription>
        </Card>
        <Card>
          <CardTitle>{SITE.bookTitle}</CardTitle>
          <CardDescription>
            Companion courses that go deeper into the book&apos;s case studies, with early access for readers.
          </CardDescription>
        </Card>
      </section>
    </>
  );
}
