import type { Metadata } from "next";
import { DecideApplication, GrantFellowForm, RevokeFellowButton } from "@/components/admin/creator-actions";
import { Card } from "@/components/ui/card";
import { listFellows, pendingApplications } from "@/lib/creators/applications";
import { getDb } from "@/lib/db";

export const metadata: Metadata = { title: "Fellows (admin)", robots: { index: false } };

export default async function AdminCreatorsPage() {
  const db = getDb();
  const [applications, fellows] = await Promise.all([pendingApplications(db), listFellows(db)]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-semibold">Fellows</h1>
      <p className="mt-2 text-muted">Fellows can upload Community Voices videos. Approving an application or granting access emails them a link to their Studio.</p>

      <section aria-labelledby="applications" className="mt-8">
        <h2 id="applications" className="text-xl font-semibold">
          Applications {applications.length > 0 && <span className="text-muted">({applications.length})</span>}
        </h2>
        {applications.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No applications waiting.</p>
        ) : (
          <div className="mt-4 space-y-4">
            {applications.map((a) => (
              <Card key={a.id}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-semibold">
                    {a.name} <span className="font-normal text-muted">· {a.email}</span>
                  </p>
                  <span className="text-xs text-muted">{a.createdAt.toLocaleDateString("en-US", { dateStyle: "medium" })}</span>
                </div>
                <p className="mt-3 whitespace-pre-line text-sm">{a.statement}</p>
                {a.sampleUrl && (
                  <a href={a.sampleUrl} target="_blank" rel="noopener noreferrer nofollow" className="mt-2 inline-block break-all text-sm underline">
                    {a.sampleUrl}
                  </a>
                )}
                <div className="mt-4 border-t border-navy-900/10 pt-4">
                  <DecideApplication applicationId={a.id} />
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="grant" className="mt-10">
        <h2 id="grant" className="text-xl font-semibold">
          Invite a Fellow
        </h2>
        <p className="mt-1 text-sm text-muted">For founding Fellows and people you&apos;ve invited: they sign up first, then you grant access here.</p>
        <Card className="mt-4">
          <GrantFellowForm />
        </Card>
      </section>

      <section aria-labelledby="current" className="mt-10">
        <h2 id="current" className="text-xl font-semibold">
          Current Fellows <span className="text-muted">({fellows.length})</span>
        </h2>
        {fellows.length > 0 && (
          <ul className="mt-4 divide-y divide-navy-900/5 rounded-xl border border-navy-900/10 bg-white">
            {fellows.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <span>
                  {f.name} <span className="text-muted">· {f.email}</span>
                </span>
                <RevokeFellowButton userId={f.id} name={f.name} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
