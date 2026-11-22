import type { Metadata } from "next";
import Link from "next/link";
import { AcceptInvitation } from "@/components/organizations/forms";
import { Button } from "@/components/ui/button";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { invitationDetails } from "@/lib/organizations/service";

export const metadata: Metadata = { title: "Join your organization", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function JoinInvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [invite, sessionUser] = await Promise.all([invitationDetails(getDb(), token), getSessionUser()]);
  const next = encodeURIComponent(`/join/${token}`);

  return (
    <div className="mx-auto max-w-xl px-4 py-16 sm:px-6">
      {!invite || invite.expired ? (
        <>
          <h1 className="text-3xl font-semibold">{invite?.expired ? "This invitation has expired" : "This invitation isn't valid"}</h1>
          <p className="mt-3 text-muted">
            {invite?.expired ? "Ask the person who invited you to send a new one." : "It may have been used already or withdrawn."} If you were given a code instead,{" "}
            <Link href="/join" className="underline">
              enter it here
            </Link>
            .
          </p>
        </>
      ) : (
        <>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-gold-600">{invite.organization}</p>
          <h1 className="mt-2 text-3xl font-semibold">
            {invite.asManager ? `Manage ${invite.organization} on Fatherhood.School` : `${invite.organization} has given you Fatherhood.School`}
          </h1>
          <p className="mt-3 text-muted">
            {invite.asManager
              ? "Invite fathers, see how many have joined, and follow how the group is doing."
              : "Full access to every course, Community Voices stories from other fathers, and a personal coach, for as long as your organization's license runs."}
          </p>
          <div className="mt-8">
            {sessionUser ? (
              <>
                <p className="mb-4 text-sm text-muted">
                  Joining as {sessionUser.email}
                  {sessionUser.email.toLowerCase() !== invite.email && ` (the invitation was sent to ${invite.email})`}.
                </p>
                <AcceptInvitation token={token} organization={invite.organization} asManager={invite.asManager} />
              </>
            ) : (
              <div className="flex flex-wrap gap-3">
                <Button asChild>
                  <Link href={`/sign-up?next=${next}`}>Create your account</Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href={`/sign-in?next=${next}`}>I have an account</Link>
                </Button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
