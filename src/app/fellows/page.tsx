import type { Metadata } from "next";
import Link from "next/link";
import { ApplyForm } from "@/components/fellows/apply-form";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getSessionUser } from "@/lib/auth";
import { COMMUNITY_MAX_DURATION_SECONDS } from "@/lib/config";
import { latestApplication } from "@/lib/creators/applications";
import { getDb } from "@/lib/db";
import { REVENUE_POLICY as P } from "@/lib/revenue/policy";

export const metadata: Metadata = {
  title: "Become a Fellow",
  description: "Fellows are fathers who share short stories and lessons on Community Voices, and share in the creator pool.",
};
export const dynamic = "force-dynamic";

const POINTS = [
  ["Share what you've lived", `Videos of up to ${COMMUNITY_MAX_DURATION_SECONDS / 60} minutes, from your phone or computer. Free for every father to watch.`],
  ["Reviewed with care", "Every video is reviewed before it's published. You'll hear back within 48 hours, with notes if anything needs changing."],
  ["Share in the creator pool", `${P.poolShareBps / 100}% of membership revenue is shared each month among Fellows, by videos posted and views.`],
] as const;

export default async function FellowsPage() {
  const sessionUser = await getSessionUser();
  const application = sessionUser?.role === "user" ? await latestApplication(getDb(), sessionUser.id) : null;

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
      <p className="text-sm font-semibold uppercase tracking-wide text-gold-600">Community Voices</p>
      <h1 className="mt-2 text-4xl font-semibold">Become a Fellow</h1>
      <p className="mt-4 max-w-2xl text-lg text-muted">
        Fellows are fathers who share short, honest stories and practical lessons from their own fathering, so other dads don&apos;t have to
        learn everything the hard way.
      </p>

      <div className="mt-10 grid gap-4 sm:grid-cols-3">
        {POINTS.map(([title, text]) => (
          <Card key={title} className="p-5">
            <h2 className="font-semibold">{title}</h2>
            <p className="mt-2 text-sm text-muted">{text}</p>
          </Card>
        ))}
      </div>

      <section aria-labelledby="apply" className="mt-12">
        <h2 id="apply" className="text-2xl font-semibold">
          {sessionUser && sessionUser.role !== "user" ? "You're a Fellow" : "Apply"}
        </h2>
        <Card className="mt-4">
          {!sessionUser ? (
            <div>
              <p className="text-muted">Create a free account or sign in, then apply here.</p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Button asChild>
                  <Link href="/sign-up?next=/fellows">Create an account</Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/sign-in?next=/fellows">Sign in</Link>
                </Button>
              </div>
            </div>
          ) : sessionUser.role !== "user" ? (
            <div>
              <p className="text-muted">Your Studio is where you upload videos and follow your views and earnings.</p>
              <Button asChild className="mt-4">
                <Link href="/studio">Open your Studio</Link>
              </Button>
            </div>
          ) : application?.status === "pending" ? (
            <p role="status">
              <span aria-hidden>✓ </span>Thanks, {sessionUser.name}. Your application is with our team (sent{" "}
              {application.createdAt.toLocaleDateString("en-US", { dateStyle: "medium" })}). We&apos;ll email you at {sessionUser.email}.
            </p>
          ) : (
            <div>
              {application?.status === "rejected" && (
                <div className="mb-6 rounded-md bg-navy-100/60 px-4 py-3 text-sm">
                  <p>Your last application wasn&apos;t accepted. You&apos;re welcome to apply again.</p>
                  {application.decisionNotes && <p className="mt-2 whitespace-pre-line text-muted">“{application.decisionNotes}”</p>}
                </div>
              )}
              <ApplyForm />
            </div>
          )}
        </Card>
      </section>
    </div>
  );
}
