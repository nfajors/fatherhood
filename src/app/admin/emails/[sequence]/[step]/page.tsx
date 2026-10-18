import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SendTestEmail } from "@/components/email/send-test";
import { previewEmail, type PreviewVariant } from "@/lib/emails/admin";
import { SEQUENCES, type SequenceId } from "@/lib/emails/sequences";
import { appUrl } from "@/lib/env";

export const metadata: Metadata = { title: "Email preview (admin)", robots: { index: false } };
export const dynamic = "force-dynamic";

const VARIANTS: { id: PreviewVariant; label: string }[] = [
  { id: "new", label: "Hasn't started" },
  { id: "progress", label: "Partway through a course" },
];

export default async function EmailPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ sequence: string; step: string }>;
  searchParams: Promise<{ variant?: string }>;
}) {
  const [{ sequence, step }, { variant: v }] = await Promise.all([params, searchParams]);
  const seq = SEQUENCES[sequence as SequenceId];
  const stepDef = seq?.steps.find((s) => s.id === step);
  if (!seq || !stepDef) notFound();
  const variant: PreviewVariant = v === "progress" ? "progress" : "new";
  const message = previewEmail(seq.id, step, variant, appUrl());

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <Link href="/admin/emails" className="text-sm text-muted underline">
        ← Emails
      </Link>
      <h1 className="mt-3 text-3xl font-semibold">
        {seq.name}: {step}
      </h1>
      <nav aria-label="Sample person" className="mt-4 flex flex-wrap gap-2">
        {VARIANTS.map((x) => (
          <Link
            key={x.id}
            href={`?variant=${x.id}`}
            aria-current={x.id === variant ? "page" : undefined}
            className={`rounded-full border px-3 py-1 text-sm ${x.id === variant ? "border-navy-900 bg-navy-900 text-white" : "border-navy-900/20 bg-white"}`}
          >
            {x.label}
          </Link>
        ))}
      </nav>
      {message ? (
        <>
          <dl className="mt-6 space-y-1 text-sm">
            <div>
              <dt className="inline text-muted">Subject: </dt>
              <dd className="inline font-medium">{message.subject}</dd>
            </div>
          </dl>
          <div className="mt-4">
            <SendTestEmail sequence={seq.id} step={step} variant={variant} />
          </div>
          <iframe title="Email preview" srcDoc={message.html} sandbox="" className="mt-4 h-[760px] w-full rounded-xl border border-navy-900/10 bg-white" />
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-medium">Plain-text version</summary>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg bg-white p-4 text-xs">{message.text}</pre>
          </details>
        </>
      ) : (
        <p className="mt-6 rounded-lg bg-navy-900/5 p-4 text-muted">This email is skipped for someone in this situation (there&apos;s nothing useful to say).</p>
      )}
    </div>
  );
}
