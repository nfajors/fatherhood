import type { Metadata } from "next";
import Link from "next/link";
import { OrganizationForm } from "@/components/organizations/forms";
import { Card } from "@/components/ui/card";
import { getDb } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import { ORG_KINDS } from "@/lib/organizations/policy";
import { listOrganizations } from "@/lib/organizations/service";

export const metadata: Metadata = { title: "Organizations (admin)", robots: { index: false } };

const day = (d: Date) => d.toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" });

export default async function AdminOrganizationsPage() {
  const orgs = await listOrganizations(getDb());
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-semibold">Organizations</h1>
      <p className="mt-2 max-w-3xl text-muted">
        Seat licenses sold on contract: add the organization, then a contract (seats, term, price per seat) and send its Stripe invoice. Its managers invite
        fathers from their own page. Contract revenue funds the creator pool like memberships.
      </p>

      {orgs.length > 0 && (
        <div className="mt-8 overflow-x-auto rounded-xl border border-navy-900/10 bg-white">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <thead className="text-muted">
              <tr>
                <th className="px-4 py-3 font-normal">Organization</th>
                <th className="px-4 py-3 font-normal">Access</th>
                <th className="px-4 py-3 text-right font-normal">Seats used</th>
                <th className="px-4 py-3 text-right font-normal">Awaiting payment</th>
                <th className="px-4 py-3 text-right font-normal">Paid</th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((o) => (
                <tr key={o.id} className="border-t border-navy-900/5">
                  <td className="px-4 py-3">
                    <Link href={`/admin/organizations/${o.id}`} className="font-semibold hover:underline">
                      {o.name}
                    </Link>
                    <span className="block text-xs text-muted">{ORG_KINDS[o.kind]}</span>
                  </td>
                  <td className="px-4 py-3">
                    {o.window.activeUntil ? `Until ${day(new Date(o.window.activeUntil.getTime() - 1))}` : o.window.startsAt ? `Starts ${day(o.window.startsAt)}` : <span className="text-muted">No contract in force</span>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {o.seatsUsed} of {o.window.seats}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{o.unpaidCents ? formatMoney(o.unpaidCents) : "–"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{o.paidCents ? formatMoney(o.paidCents) : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section aria-labelledby="new" className="mt-10">
        <h2 id="new" className="text-xl font-semibold">
          Add an organization
        </h2>
        <Card className="mt-4">
          <OrganizationForm />
        </Card>
      </section>
    </div>
  );
}
