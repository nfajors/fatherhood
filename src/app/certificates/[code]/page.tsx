import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/learning/print-button";
import { Button } from "@/components/ui/button";
import { getSessionUser } from "@/lib/auth";
import { SITE } from "@/lib/config";
import { getDb } from "@/lib/db";
import { appUrl } from "@/lib/env";
import { certificateByCode, linkedInAddUrl } from "@/lib/learning/certificates";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ code: string }> };

const CODE = /^FS-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/i;

const issued = (date: Date) => date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { code } = await params;
  const found = CODE.test(code) ? await certificateByCode(getDb(), code) : null;
  if (!found || found.certificate.revokedAt) return { title: "Certificate", robots: { index: false } };
  const c = found.certificate;
  return {
    title: `${c.recipientName}: ${c.courseTitle} certificate`,
    description: `${c.recipientName} completed ${c.courseTitle} at ${SITE.name}.`,
    robots: { index: false },
  };
}

/** A shareable, printable certificate that doubles as its own verification page. */
export default async function CertificatePage({ params }: Params) {
  const { code } = await params;
  if (!CODE.test(code)) notFound();
  const db = getDb();
  const found = await certificateByCode(db, code);
  if (!found) notFound();
  const c = found.certificate;
  const url = `${appUrl()}/certificates/${c.code}`;

  if (c.revokedAt) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center sm:px-6">
        <h1 className="text-3xl font-semibold">Certificate revoked</h1>
        <p className="mt-3 text-muted">
          Certificate {c.code} was issued by {SITE.name} but is no longer valid.
        </p>
      </div>
    );
  }

  const viewer = await getSessionUser().catch(() => null);
  const mine = viewer?.id === c.userId;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 print:max-w-none print:p-0">
      <style>{"@page { size: landscape; margin: 0.4in; } @media print { body { background: white; } }"}</style>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <p className="text-sm text-green-800">
          <span aria-hidden>✓ </span>Verified: issued by {SITE.name} on {issued(c.issuedAt)}.
        </p>
        <div className="flex flex-wrap gap-2">
          {mine && (
            <Button asChild size="sm" variant="outline">
              <a href={linkedInAddUrl(c, url, SITE.name)} target="_blank" rel="noopener noreferrer">
                Add to LinkedIn
              </a>
            </Button>
          )}
          <PrintButton />
        </div>
      </div>

      <article
        aria-label="Certificate of completion"
        className="relative border-[10px] border-double border-navy-900 bg-white px-6 py-12 text-center sm:px-14 sm:py-16 print:break-inside-avoid"
      >
        <div className="pointer-events-none absolute inset-3 border border-gold-500" aria-hidden />
        <p className="font-serif text-xl tracking-wide text-navy-900">{SITE.name}</p>
        <p className="mt-8 text-sm font-semibold uppercase tracking-[0.3em] text-gold-600">Certificate of completion</p>
        <p className="mt-8 text-muted">This certifies that</p>
        <p className="mt-3 break-words font-serif text-4xl text-navy-950 sm:text-5xl">{c.recipientName}</p>
        <p className="mt-6 text-muted">has completed the course</p>
        <p className="mt-3 break-words font-serif text-2xl text-navy-900 sm:text-3xl">{c.courseTitle}</p>
        <div className="mx-auto mt-12 grid max-w-lg gap-6 text-sm sm:grid-cols-2">
          <div className="border-t border-navy-900/30 pt-2">
            <p className="font-medium text-navy-900">{issued(c.issuedAt)}</p>
            <p className="text-muted">Date issued</p>
          </div>
          <div className="border-t border-navy-900/30 pt-2">
            <p className="font-mono font-medium text-navy-900">{c.code}</p>
            <p className="text-muted">Certificate ID</p>
          </div>
        </div>
        <p className="mt-10 break-all text-xs text-muted">Verify at {url.replace(/^https?:\/\//, "")}</p>
      </article>

      <p className="mt-6 text-center text-sm text-muted print:hidden">
        <Link href={`/academy/${found.courseSlug}`} className="underline">
          About the course
        </Link>
      </p>
    </div>
  );
}
