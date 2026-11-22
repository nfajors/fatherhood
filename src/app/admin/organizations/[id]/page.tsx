import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ContractActions, ContractForm, InviteForm, MemberAction, OrganizationForm } from "@/components/organizations/forms";
import { Card } from "@/components/ui/card";
import { getDb } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import { accessWindow, contractsFor, getOrganization, organizationPeople } from "@/lib/organizations/service";

export const metadata: Metadata = { title: "Organization (admin)", robots: { index: false } };

const day = (d: Date) => d.toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" });
const lastDay = (end: Date) => day(new Date(end.getTime() - 1));
const STATUS = { draft: "Draft", invoiced: "Invoiced, awaiting payment", paid: "Paid", void: "Void" } as const;

export default async function AdminOrganizationPage({ params }: { params: Promise<{ id: string }> }) {
  const id = z.uuid().safeParse((await params).id);
  const db = getDb();
  const org = id.success ? await getOrganization(db, { id: id.data }) : null;
  if (!org) notFound();
  const [contracts, people] = await Promise.all([contractsFor(db, org.id), organizationPeople(db, org.id)]);
  const window = accessWindow(contracts, new Date());

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <p className="text-sm">
        <Link href="/admin/organizations" className="underline-offset-2 hover:underline">
          ← Organizations
        </Link>
      </p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-3xl font-semibold">{org.name}</h1>
        <Link href={`/org/${org.slug}`} className="text-sm font-semibold underline-offset-2 hover:underline">
          Open the managers&apos; page →
        </Link>
      </div>
      <p className="mt-2 text-muted">
        {window.activeUntil ? `Access until ${lastDay(window.activeUntil)}` : window.startsAt ? `Access starts ${day(window.startsAt)}` : "No contract in force"} ·{" "}
        {people.fathers.length} of {window.seats} seats used · {people.invited.length} invited
      </p>

      <section aria-labelledby="contracts" className="mt-10">
        <h2 id="contracts" className="text-xl font-semibold">
          Contracts
        </h2>
        {contracts.length > 0 && (
          <div className="mt-4 space-y-3">
            {contracts.map((c) => (
              <Card key={c.id} className="p-4">
                <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                  <div>
                    <p className="font-semibold">
                      {c.seats} seats · {day(c.startsAt)} to {lastDay(c.endsAt)} · {formatMoney(c.amountCents)}
                      <span className="ml-2 text-sm font-normal text-muted">({formatMoney(c.pricePerSeatCents)} a seat)</span>
                    </p>
                    <p className="mt-1 text-sm">
                      <strong>{STATUS[c.status]}</strong>
                      {c.invoicedAt && ` · sent ${day(c.invoicedAt)}, due in ${c.daysUntilDue} days`}
                      {c.paidAt && ` · ${day(c.paidAt)}`}
                      {c.paymentNote && ` (${c.paymentNote})`}
                      {c.invoiceUrl && (
                        <>
                          {" "}
                          ·{" "}
                          <a href={c.invoiceUrl} target="_blank" rel="noopener noreferrer" className="underline">
                            Invoice
                          </a>
                        </>
                      )}
                    </p>
                    {c.notes && <p className="mt-1 text-sm text-muted">{c.notes}</p>}
                  </div>
                  <ContractActions id={c.id} status={c.status} amount={formatMoney(c.amountCents)} />
                </div>
              </Card>
            ))}
          </div>
        )}
        <Card className="mt-4">
          <h3 className="text-lg font-semibold">New contract</h3>
          <p className="mt-1 text-sm text-muted">For a renewal, start it the day after the current one ends; access carries straight on. To add seats mid-term, add a contract for the extra seats over the same dates.</p>
          <div className="mt-4">
            <ContractForm orgId={org.id} />
          </div>
        </Card>
      </section>

      <section aria-labelledby="managers" className="mt-10">
        <h2 id="managers" className="text-xl font-semibold">
          Managers
        </h2>
        <p className="mt-1 text-sm text-muted">They invite fathers and see the organization&apos;s page. Managers use no seat.</p>
        {people.managers.length > 0 && (
          <ul className="mt-3 divide-y divide-navy-900/5 rounded-xl border border-navy-900/10 bg-white">
            {people.managers.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                <span>
                  {m.name} <span className="text-muted">· {m.email}</span>
                </span>
                <MemberAction url={`/api/org/${org.id}/members/${m.id}`} label="Remove" confirm={`Remove ${m.email} as a manager?`} />
              </li>
            ))}
          </ul>
        )}
        {people.invited.filter((p) => p.isManager).length > 0 && (
          <p className="mt-2 text-sm text-muted">Invited: {people.invited.filter((p) => p.isManager).map((p) => p.email).join(", ")}</p>
        )}
        <Card className="mt-4">
          <InviteForm orgId={org.id} asManager />
        </Card>
      </section>

      <section aria-labelledby="details" className="mt-10">
        <h2 id="details" className="text-xl font-semibold">
          Details
        </h2>
        <Card className="mt-4">
          <OrganizationForm id={org.id} initial={{ name: org.name, kind: org.kind, contactName: org.contactName, contactEmail: org.contactEmail }} />
        </Card>
      </section>
    </div>
  );
}
