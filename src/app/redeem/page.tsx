import type { Metadata } from "next";
import Link from "next/link";
import { RedeemForm } from "@/components/gifts/redeem-form";
import { Button } from "@/components/ui/button";
import { getSessionUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Redeem a gift", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function RedeemPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code } = await searchParams;
  const sessionUser = await getSessionUser();
  const next = `/redeem${code ? `?code=${encodeURIComponent(code)}` : ""}`;

  return (
    <div className="mx-auto max-w-lg px-4 py-16 sm:px-6">
      <p className="text-sm font-semibold uppercase tracking-widest text-gold-600">Gift membership</p>
      <h1 className="mt-3 text-4xl font-semibold">Redeem your gift</h1>
      {sessionUser ? (
        <>
          <p className="mt-4 text-muted">The membership will be added to {sessionUser.email}.</p>
          <div className="mt-8">
            <RedeemForm initialCode={code} />
          </div>
        </>
      ) : (
        <>
          <p className="mt-4 text-lg text-muted">
            Create a free account (or sign in) and your membership is added to it right away.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild>
              <Link href={`/sign-up?next=${encodeURIComponent(next)}`}>Create an account</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/sign-in?next=${encodeURIComponent(next)}`}>Sign in</Link>
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
