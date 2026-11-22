import type { Metadata } from "next";
import Link from "next/link";
import { PathSteps } from "@/components/coach/path-card";
import { ProfileForm, ReplanButton } from "@/components/coach/plan-forms";
import { CoachBlocked, CoachShell, coachMember } from "@/components/coach/shell";
import { Card } from "@/components/ui/card";
import { getProfile } from "@/lib/coach/context";
import { getPath } from "@/lib/coach/path";
import { getDb } from "@/lib/db";

export const metadata: Metadata = { title: "Your plan", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function CoachPlanPage() {
  const access = await coachMember("/coach/plan");
  if ("blocked" in access) return <CoachBlocked reason={access.blocked} />;
  const db = getDb();
  const [profile, path] = await Promise.all([getProfile(db, access.member.id), getPath(db, access.member.id)]);
  return (
    <CoachShell member={access.member} activeId="plan">
      <h1 className="text-3xl font-semibold">Your plan</h1>
      <p className="mt-2 max-w-2xl text-muted">
        Tell the coach where you are and what you want to work on. It plans a path of lessons and stories for you, and keeps it in mind when you
        talk.
      </p>
      <div className="mt-8 grid gap-6 xl:grid-cols-2">
        <Card>
          <h2 className="text-xl font-semibold">About you</h2>
          <div className="mt-4">
            <ProfileForm initial={profile ? { stage: profile.stage, children: profile.children, goals: profile.goals } : null} />
          </div>
        </Card>
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h2 className="text-xl font-semibold">Your learning path</h2>
            {path && <ReplanButton />}
          </div>
          <div className="mt-4">
            {path ? (
              <>
                <PathSteps path={path} />
                <p className="mt-4 text-sm">
                  <Link href="/coach" className="font-semibold underline-offset-2 hover:underline">
                    Talk it through with the coach →
                  </Link>
                </p>
              </>
            ) : (
              <p className="text-muted">Save the form and your path appears here.</p>
            )}
          </div>
        </Card>
      </div>
    </CoachShell>
  );
}
