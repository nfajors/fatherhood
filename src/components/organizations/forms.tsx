"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { ErrorText, useApiAction } from "@/components/use-api-action";
import { Button } from "@/components/ui/button";
import { ORG_KINDS } from "@/lib/organizations/policy";

const field = "mt-1 block w-full rounded-md border border-navy-900/20 bg-white px-3 py-2";

async function post(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & { message?: string; error?: string };
  return { ok: res.ok, data, message: data.message ?? data.error ?? (res.ok ? null : `Request failed (${res.status})`) };
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

type OrgDetails = { name: string; kind: keyof typeof ORG_KINDS; contactName: string | null; contactEmail: string };

export function OrganizationForm({ id, initial }: { id?: string; initial?: OrgDetails }) {
  const router = useRouter();
  const { pending, error, run } = useApiAction();
  const [form, setForm] = useState<OrgDetails>(initial ?? { name: "", kind: "nonprofit", contactName: "", contactEmail: "" });
  const [creating, startCreate] = useTransition();
  const [createError, setCreateError] = useState<string | null>(null);
  const set = <K extends keyof OrgDetails>(key: K, value: OrgDetails[K]) => setForm((f) => ({ ...f, [key]: value }));

  function submit(event: FormEvent) {
    event.preventDefault();
    const body = { ...form, contactName: form.contactName || null };
    if (id) return run(`/api/admin/organizations/${id}`, "PATCH", body);
    setCreateError(null);
    startCreate(async () => {
      const res = await post("/api/admin/organizations", "POST", body);
      if (res.ok) router.push(`/admin/organizations/${res.data.id as string}`);
      else setCreateError(res.message);
    });
  }
  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      <label className="block text-sm font-medium">
        Name
        <input value={form.name} onChange={(e) => set("name", e.target.value)} required maxLength={120} className={field} placeholder="Dads Forward" />
      </label>
      <label className="block text-sm font-medium">
        Kind
        <select value={form.kind} onChange={(e) => set("kind", e.target.value as OrgDetails["kind"])} className={field}>
          {Object.entries(ORG_KINDS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm font-medium">
        Billing contact <span className="font-normal text-muted">(optional)</span>
        <input value={form.contactName ?? ""} onChange={(e) => set("contactName", e.target.value)} maxLength={120} className={field} placeholder="Jo Rivera" />
      </label>
      <label className="block text-sm font-medium">
        Billing email <span className="font-normal text-muted">(invoices go here)</span>
        <input type="email" value={form.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} required className={field} placeholder="billing@example.org" />
      </label>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending || creating}>
          {id ? "Save" : "Create organization"}
        </Button>
        <ErrorText error={error ?? createError} />
      </div>
    </form>
  );
}

const today = () => new Date().toISOString().slice(0, 10);
const yearFromToday = () => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

export function ContractForm({ orgId }: { orgId: string }) {
  const { pending, error, run } = useApiAction();
  const [seats, setSeats] = useState("25");
  const [price, setPrice] = useState("99");
  const [startsOn, setStartsOn] = useState(today());
  const [endsOn, setEndsOn] = useState(yearFromToday());
  const [days, setDays] = useState("30");
  const [notes, setNotes] = useState("");
  const total = (Number(seats) || 0) * (Number(price) || 0);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(`/api/admin/organizations/${orgId}/contracts`, "POST", {
          seats: Number(seats),
          pricePerSeatCents: Math.round(Number(price) * 100),
          startsOn,
          endsOn,
          daysUntilDue: Number(days),
          notes: notes || null,
        });
      }}
      className="grid gap-4 sm:grid-cols-3"
    >
      <label className="block text-sm font-medium">
        Seats
        <input type="number" min={1} value={seats} onChange={(e) => setSeats(e.target.value)} required className={field} />
      </label>
      <label className="block text-sm font-medium">
        Price per seat ($)
        <input type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} required className={field} />
      </label>
      <label className="block text-sm font-medium">
        Payment terms (days)
        <input type="number" min={0} max={120} value={days} onChange={(e) => setDays(e.target.value)} className={field} />
      </label>
      <label className="block text-sm font-medium">
        First day
        <input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} required className={field} />
      </label>
      <label className="block text-sm font-medium">
        Last day
        <input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} required className={field} />
      </label>
      <label className="block text-sm font-medium">
        Notes <span className="font-normal text-muted">(internal)</span>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} className={field} placeholder="PO 4471, grant-funded" />
      </label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
        <Button type="submit" disabled={pending}>
          Add draft contract
        </Button>
        <span className="text-sm text-muted">Total {total.toLocaleString("en-US", { style: "currency", currency: "USD" })}. Nothing is sent yet.</span>
        <ErrorText error={error} />
      </div>
    </form>
  );
}

export function ContractActions({ id, status, amount }: { id: string; status: "draft" | "invoiced" | "paid" | "void"; amount: string }) {
  const { pending, error, run } = useApiAction();
  const [recording, setRecording] = useState(false);
  const [note, setNote] = useState("");
  if (status === "paid" || status === "void") return null;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {status === "draft" && (
          <Button
            size="sm"
            disabled={pending}
            onClick={() => window.confirm(`Email a Stripe invoice for ${amount} to the billing contact? Access starts on the first day, while it awaits payment.`) && run(`/api/admin/contracts/${id}/invoice`, "POST")}
          >
            Send invoice
          </Button>
        )}
        {status === "draft" && (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => setRecording((r) => !r)} aria-expanded={recording}>
            Paid without an invoice
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => window.confirm("Void this contract? Its seats lose access.") && run(`/api/admin/contracts/${id}/void`, "POST")}>
          Void
        </Button>
      </div>
      {recording && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(`/api/admin/contracts/${id}/mark-paid`, "POST", { note }, () => setRecording(false));
          }}
        >
          <label className="block text-sm font-medium">
            How it was paid
            <input value={note} onChange={(e) => setNote(e.target.value)} required maxLength={500} className={field} placeholder="Check #1042 / free pilot" />
          </label>
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            Record {amount} paid
          </Button>
        </form>
      )}
      <ErrorText error={error} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Managers
// ---------------------------------------------------------------------------

export function InviteForm({ orgId, asManager = false }: { orgId: string; asManager?: boolean }) {
  const router = useRouter();
  const [emails, setEmails] = useState("");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        setResult(null);
        start(async () => {
          const res = await post(`/api/org/${orgId}/invites`, "POST", { emails, asManager });
          if (!res.ok) return setError(res.message);
          const d = res.data as { invited: number; alreadyJoined: string[]; invalid: string[]; failed: string[] };
          const parts = [`✓ ${d.invited} ${d.invited === 1 ? "invitation" : "invitations"} sent.`];
          if (d.alreadyJoined.length) parts.push(`Already joined: ${d.alreadyJoined.join(", ")}.`);
          if (d.invalid.length) parts.push(`Not email addresses: ${d.invalid.join(", ")}.`);
          if (d.failed.length) parts.push(`Couldn't send to: ${d.failed.join(", ")}.`);
          setResult(parts.join(" "));
          setEmails("");
          router.refresh();
        });
      }}
    >
      <label className="block text-sm font-medium">
        {asManager ? "Managers' email addresses" : "Fathers' email addresses"}
        <textarea
          value={emails}
          onChange={(e) => setEmails(e.target.value)}
          required
          rows={asManager ? 2 : 4}
          className={field}
          placeholder={"marcus@example.com\nsam@example.com"}
        />
      </label>
      <p className="text-xs text-muted">One per line, or separated by commas. Each person gets a link that works for 30 days{asManager ? "." : "; inviting someone again sends a fresh link."}</p>
      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : asManager ? "Invite managers" : "Send invitations"}
      </Button>
      {result && (
        <p role="status" className="text-sm text-emerald-800">
          {result}
        </p>
      )}
      <ErrorText error={error} />
    </form>
  );
}

export function MemberAction({ url, label, confirm }: { url: string; label: string; confirm: string }) {
  const { pending, error, run } = useApiAction();
  return (
    <>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => window.confirm(confirm) && run(url, "DELETE")}>
        {label}
      </Button>
      <ErrorText error={error} />
    </>
  );
}

export function JoinCodeControls({ orgId, code, enabled }: { orgId: string; code: string | null; enabled: boolean }) {
  const { pending, error, run } = useApiAction();
  return (
    <div className="space-y-3">
      {enabled && code ? (
        <p>
          <span className="block text-sm text-muted">Fathers can join at fatherhood.school/join with</span>
          <span className="font-mono text-2xl font-semibold tracking-wider">{code}</span>
        </p>
      ) : (
        <p className="text-sm text-muted">Off. Turn it on to hand out one code (in a class or a flyer) instead of emailing each father.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={enabled ? "outline" : "primary"} disabled={pending} onClick={() => run(`/api/org/${orgId}/join-code`, "POST", { enabled: !enabled })}>
          {enabled ? "Turn off" : "Turn on"}
        </Button>
        {enabled && (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => window.confirm("Replace the code? The old one stops working.") && run(`/api/org/${orgId}/join-code`, "POST", { enabled: true, rotate: true })}>
            New code
          </Button>
        )}
      </div>
      <ErrorText error={error} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fathers
// ---------------------------------------------------------------------------

function ShareChoice({ organization, onChoose, pending }: { organization: string; onChoose: (share: boolean) => void; pending: boolean }) {
  return (
    <div className="space-y-3">
      <p className="text-sm">
        Can {organization} see your name and your progress (lessons finished, certificates, time watched)? Programs that need to confirm you completed
        the course will ask you to share. You can change this any time on your account page. Your conversations with the coach are never shared.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button disabled={pending} onClick={() => onChoose(true)}>
          Join and share my progress
        </Button>
        <Button variant="outline" disabled={pending} onClick={() => onChoose(false)}>
          Join without sharing
        </Button>
      </div>
    </div>
  );
}

export function AcceptInvitation({ token, organization, asManager }: { token: string; organization: string; asManager: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const accept = (share: boolean) =>
    start(async () => {
      setError(null);
      const res = await post("/api/join/accept", "POST", { token, share });
      if (!res.ok) return setError(res.message);
      const d = res.data as { slug: string; asManager: boolean };
      router.push(d.asManager ? `/org/${d.slug}` : "/learning?joined=1");
      router.refresh();
    });
  return (
    <div>
      {asManager ? (
        <Button disabled={pending} onClick={() => accept(false)}>
          Accept and open the account
        </Button>
      ) : (
        <ShareChoice organization={organization} onChoose={accept} pending={pending} />
      )}
      <ErrorText error={error} />
    </div>
  );
}

export function JoinCodeForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"code" | "share">("code");
  const join = (share: boolean) =>
    start(async () => {
      setError(null);
      const res = await post("/api/join/code", "POST", { code, share });
      if (!res.ok) {
        setStep("code");
        return setError(res.message);
      }
      router.push("/learning?joined=1");
      router.refresh();
    });
  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setStep("share");
        }}
        className="flex flex-wrap items-end gap-3"
      >
        <label className="block text-sm font-medium">
          Your organization&apos;s code
          <input value={code} onChange={(e) => setCode(e.target.value)} required className={`${field} font-mono uppercase`} placeholder="ORG-XXXX-XXXX" autoComplete="off" />
        </label>
        {step === "code" && <Button type="submit">Continue</Button>}
      </form>
      {step === "share" && <ShareChoice organization="your organization" onChoose={join} pending={pending} />}
      <ErrorText error={error} />
    </div>
  );
}

export function SharingControls({ memberId, organization, shares }: { memberId: string; organization: string; shares: boolean }) {
  const { pending, error, run } = useApiAction();
  return (
    <div className="space-y-2">
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={shares} disabled={pending} onChange={(e) => run(`/api/me/organizations/${memberId}`, "PATCH", { share: e.target.checked })} />
        <span>Share my name and progress with {organization}</span>
      </label>
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => window.confirm(`Leave ${organization}? Your progress stays on your account, but your access through ${organization} ends.`) && run(`/api/me/organizations/${memberId}`, "DELETE")}
      >
        Leave {organization}
      </Button>
      <ErrorText error={error} />
    </div>
  );
}
