import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { InviteForm, JoinCodeControls, MemberAction } from "@/components/organizations/forms";
import { Stat } from "@/components/studio/earnings";
import { Card } from "@/components/ui/card";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { formatWatchTime } from "@/lib/format";
import { ORG_POLICY } from "@/lib/organizations/policy";
import { organizationReport } from "@/lib/organizations/reports";
import { getOrganization, isManagerOf, organizationPeople } from "@/lib/organizations/service";

export const metadata: Metadata = { title: "Your organization", robots: { index: false } };
export const dynamic = "force-dynamic";

const day = (d: Date) => d.toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" });

/** The managers' page: seats, invitations, the join code, and how the group is doing. */
export default async function OrganizationPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect(`/sign-in?next=/org/${slug}`);
  const db = getDb();
  const org = await getOrganization(db, { slug });
  if (!org || (sessionUser.role !== "admin" && !(await isManagerOf(db, sessionUser.id, org.id)))) notFound();
  const [report, people] = await Promise.all([organizationReport(db, org.id), organizationPeople(db, org.id)]);
  const r = report!;
  const fatherInvites = people.invited.filter((p) => !p.isManager);
  const over = r.seats.used - r.seats.total;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <p className="text-sm font-semibold uppercase tracking-[0.2em] text-gold-600">Organization</p>
      <h1 className="mt-1 text-3xl font-semibold">{org.name}</h1>
      <p className="mt-2 text-muted">
        {r.window.activeUntil
          ? `Access for your fathers until ${day(new Date(r.window.activeUntil.getTime() - 1))}.`
          : r.window.startsAt
            ? `Access starts ${day(r.window.startsAt)}. Fathers can join now.`
            : "Your license isn't active. Contact us to renew."}
      </p>

      <section aria-label="Seats and progress" className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Seats used" value={`${r.seats.used} of ${r.seats.total}`} detail={`${r.seats.invited} invited, not joined yet`} />
        <Stat label="Active in the last 30 days" value={String(r.totals.activeLast30)} detail={`of ${r.totals.fathers} ${r.totals.coverage === "everyone" ? "fathers" : "who share"}`} />
        <Stat label="Lessons completed" value={r.totals.lessonsCompleted.toLocaleString("en-US")} />
        <Stat label="Certificates earned" value={String(r.totals.certificates)} detail={`${formatWatchTime(r.totals.watchSeconds)} watched since joining`} />
      </section>
      <p className="mt-3 text-xs text-muted">
        {r.totals.coverage === "everyone"
          ? "Totals include every father with a seat."
          : `Totals include only the ${r.sharingCount} ${r.sharingCount === 1 ? "father" : "fathers"} who share their progress, so the few who keep theirs private (fewer than ${ORG_POLICY.privacyGroupSize}) can't be picked out.`}{" "}
        Conversations with the coach are never shared.
      </p>
      {over > 0 && (
        <p role="alert" className="mt-4 rounded-lg bg-gold-100 px-4 py-3 text-sm">
          {over} more {over === 1 ? "father has" : "fathers have"} joined than you have seats. Remove someone who has left, or contact us to add seats.
        </p>
      )}

      <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_22rem]">
        <section aria-labelledby="fathers">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2 id="fathers" className="text-xl font-semibold">
              Fathers ({r.people.length})
            </h2>
            {r.sharingCount > 0 && (
              <a href={`/api/org/${org.id}/export`} className="text-sm font-semibold underline-offset-2 hover:underline">
                Download progress (CSV)
              </a>
            )}
          </div>
          <p className="mt-1 text-sm text-muted">
            {r.sharingCount} {r.sharingCount === 1 ? "shares his" : "share their"} progress; {r.privateCount} {r.privateCount === 1 ? "keeps his" : "keep theirs"} private. Each father
            chooses when he joins and can change it any time.
          </p>
          {r.people.length === 0 ? (
            <p className="mt-4 text-sm text-muted">No one has joined yet. Invite fathers, or turn on the join code.</p>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-xl border border-navy-900/10 bg-white">
              <table className="w-full min-w-[40rem] text-left text-sm">
                <thead className="text-muted">
                  <tr>
                    <th className="px-4 py-3 font-normal">Father</th>
                    <th className="px-4 py-3 text-right font-normal">Lessons</th>
                    <th className="px-4 py-3 font-normal">Certificates</th>
                    <th className="px-4 py-3 font-normal">Last active</th>
                    <th className="px-4 py-3 font-normal">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {r.people.map((p) => (
                    <tr key={p.id} className="border-t border-navy-900/5 align-top">
                      <td className="px-4 py-3">
                        {p.name}
                        <span className="block text-xs text-muted">
                          {p.email}
                          {p.joinedAt && ` · joined ${day(p.joinedAt)}`}
                        </span>
                      </td>
                      {p.progress ? (
                        <>
                          <td className="px-4 py-3 text-right tabular-nums">{p.progress.lessonsCompleted}</td>
                          <td className="px-4 py-3">{p.progress.certificates.join(", ") || "–"}</td>
                          <td className="px-4 py-3">{p.progress.lastActiveAt ? day(p.progress.lastActiveAt) : "–"}</td>
                        </>
                      ) : (
                        <td colSpan={3} className="px-4 py-3 text-muted">
                          Keeps his progress private
                        </td>
                      )}
                      <td className="px-4 py-3 text-right">
                        <MemberAction url={`/api/org/${org.id}/members/${p.id}`} label="Remove" confirm={`Remove ${p.name}? His access through ${org.name} ends and his seat frees up. His own account and progress stay.`} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {fatherInvites.length > 0 && (
            <div className="mt-6">
              <h3 className="font-semibold">Invited, not joined yet ({fatherInvites.length})</h3>
              <ul className="mt-2 divide-y divide-navy-900/5 rounded-xl border border-navy-900/10 bg-white">
                {fatherInvites.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                    <span>
                      {p.email}
                      {p.inviteExpiresAt && <span className="text-muted"> · link works until {day(p.inviteExpiresAt)}</span>}
                    </span>
                    <MemberAction url={`/api/org/${org.id}/invites/${p.id}`} label="Withdraw" confirm={`Withdraw the invitation to ${p.email}?`} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <div className="space-y-6">
          <Card>
            <h2 className="text-lg font-semibold">Invite fathers</h2>
            <div className="mt-3">
              <InviteForm orgId={org.id} />
            </div>
          </Card>
          <Card>
            <h2 className="text-lg font-semibold">Join code</h2>
            <div className="mt-3">
              <JoinCodeControls orgId={org.id} code={org.joinCode} enabled={org.joinCodeEnabled} />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
