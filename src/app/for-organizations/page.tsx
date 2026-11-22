import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SITE } from "@/lib/config";

export const metadata: Metadata = {
  title: "For organizations",
  description: `Give the fathers you serve ${SITE.name}: fatherhood programs, employers, universities, the military and government programs.`,
};

const POINTS = [
  { title: "Everything members get", body: "Every course in the Professional Academy, Community Voices stories from other fathers, certificates, and a personal AI coach." },
  { title: "Easy to roll out", body: "Invite fathers by email, or hand out one join code in a class or on a flyer. Seats move when someone leaves." },
  { title: "Reports that respect fathers", body: "See seats used and how the group is doing. Each father chooses whether you see his name and progress; programs that verify completion ask him to share." },
  { title: "Invoiced on your terms", body: "An annual license for the seats you need, on an invoice your finance team can pay by card or bank transfer. Purchase orders welcome." },
];

export default function ForOrganizationsPage() {
  return (
    <div>
      <section className="bg-navy-950 text-white">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-gold-400">For organizations</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-semibold text-white sm:text-5xl">Give the fathers you serve a school of their own.</h1>
          <p className="mt-5 max-w-2xl text-lg text-white/80">
            Fatherhood programs, employers, universities, the military, courts and faith communities use {SITE.name} to help fathers show up for their children.
          </p>
          <Button asChild size="lg" className="mt-8">
            <a href={`mailto:hello@${SITE.domain}?subject=${encodeURIComponent(`${SITE.name} for our organization`)}`}>Talk to us</a>
          </Button>
        </div>
      </section>
      <section className="mx-auto grid max-w-6xl gap-6 px-4 py-16 sm:grid-cols-2 sm:px-6">
        {POINTS.map((p) => (
          <Card key={p.title}>
            <h2 className="text-xl font-semibold">{p.title}</h2>
            <p className="mt-2 text-muted">{p.body}</p>
          </Card>
        ))}
      </section>
      <p className="mx-auto max-w-6xl px-4 text-sm text-muted sm:px-6">
        Already have a code from your organization?{" "}
        <Link href="/join" className="underline">
          Join here
        </Link>
        .
      </p>
    </div>
  );
}
