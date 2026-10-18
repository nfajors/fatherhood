import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { getDb } from "@/lib/db";
import { optOutCounts, recentSends, sequenceStats } from "@/lib/emails/admin";
import { CATEGORY_LABELS, EMAIL_CATEGORIES } from "@/lib/emails/policy";
import { SEQUENCES } from "@/lib/emails/sequences";

export const metadata: Metadata = { title: "Emails (admin)", robots: { index: false } };
export const dynamic = "force-dynamic";

const when = (hours: number) => (hours === 0 ? "Right away" : hours % 24 === 0 ? `Day ${hours / 24}` : `${hours} hours`);
const STATUS_TONE = { sent: "text-green-800", skipped: "text-muted", failed: "text-red-700" } as const;

export default async function AdminEmailsPage() {
  const db = getDb();
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [stats, sends, optOuts] = await Promise.all([sequenceStats(db, since), recentSends(db), optOutCounts(db)]);
  const warnings = [
    !process.env.RESEND_API_KEY && "RESEND_API_KEY isn't set, so emails are written to the server log instead of sent.",
    !process.env.EMAIL_POSTAL_ADDRESS && "EMAIL_POSTAL_ADDRESS isn't set. US law (CAN-SPAM) requires a postal address in these emails before sending them for real.",
  ].filter(Boolean) as string[];

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-semibold">Emails</h1>
      <p className="mt-2 max-w-3xl text-muted">
        Sequences send automatically (checked every 15 minutes). Each email is shown just before sending with what the person has actually done, and
        skipped when it has nothing useful to say. Counts cover the last 30 days.
      </p>
      {warnings.map((w) => (
        <p key={w} className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          {w}
        </p>
      ))}

      <div className="mt-8 space-y-6">
        {stats.map((s) => {
          const seq = SEQUENCES[s.id];
          return (
            <Card key={s.id} className="p-0">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-navy-900/10 p-5">
                <div>
                  <h2 className="text-xl font-semibold">{seq.name}</h2>
                  <p className="mt-1 text-sm text-muted">{seq.audience}</p>
                  <p className="mt-1 text-xs text-muted">Setting: {CATEGORY_LABELS[seq.category].label}</p>
                </div>
                <dl className="flex gap-5 text-sm">
                  {(["active", "completed", "exited"] as const).map((k) => (
                    <div key={k}>
                      <dt className="text-muted">{k === "exited" ? "Left early" : k === "active" ? "In progress" : "Finished"}</dt>
                      <dd className="text-lg font-semibold">{s.enrollments[k]}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <thead className="text-left text-muted">
                    <tr>
                      <th className="px-5 py-2 font-medium">Email</th>
                      <th className="px-3 py-2 font-medium">When</th>
                      <th className="px-3 py-2 text-right font-medium">Sent</th>
                      <th className="px-3 py-2 text-right font-medium">Skipped</th>
                      <th className="px-3 py-2 text-right font-medium">Failed</th>
                      <th className="px-5 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-navy-900/10">
                    {s.steps.map((step) => (
                      <tr key={step.id}>
                        <td className="px-5 py-2 font-medium text-navy-900">{step.id}</td>
                        <td className="px-3 py-2">{when(step.delayHours)}</td>
                        <td className="px-3 py-2 text-right">{step.sent}</td>
                        <td className="px-3 py-2 text-right">{step.skipped}</td>
                        <td className={`px-3 py-2 text-right ${step.failed ? "text-red-700" : ""}`}>{step.failed}</td>
                        <td className="px-5 py-2 text-right">
                          <Link href={`/admin/emails/${s.id}/${step.id}`} className="underline">
                            Preview
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          );
        })}
      </div>

      <section className="mt-10" aria-labelledby="optouts">
        <h2 id="optouts" className="text-2xl font-semibold">
          Opt-outs
        </h2>
        <ul className="mt-3 grid gap-3 sm:grid-cols-3">
          {EMAIL_CATEGORIES.map((c) => (
            <li key={c} className="rounded-xl border border-navy-900/10 bg-white p-4">
              <p className="text-sm text-muted">{CATEGORY_LABELS[c].label}</p>
              <p className="text-2xl font-semibold">{optOuts[c]}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10" aria-labelledby="recent">
        <h2 id="recent" className="text-2xl font-semibold">
          Recent emails
        </h2>
        {sends.length === 0 ? (
          <p className="mt-3 text-muted">Nothing sent yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-navy-900/10 rounded-xl border border-navy-900/10 bg-white text-sm">
            {sends.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 p-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-navy-900">{e.subject}</span>
                  <span className="block truncate text-muted">
                    {e.email} · {e.sequence ? `${SEQUENCES[e.sequence as keyof typeof SEQUENCES]?.name ?? e.sequence} / ${e.step}` : "Reply notification"}
                  </span>
                  {e.error && <span className="block text-red-700">{e.error}</span>}
                </span>
                <span className={STATUS_TONE[e.status]}>{e.status}</span>
                <span className="text-muted">{e.createdAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
