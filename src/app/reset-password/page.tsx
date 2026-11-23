import type { Metadata } from "next";
import Link from "next/link";
import { ResetPasswordForm } from "@/components/auth/password-reset-forms";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Choose a new password", robots: { index: false }, referrer: "no-referrer" };

/** Where the emailed link lands (via Better Auth, which checks the link and adds ?token= or ?error=). */
export default async function Page({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token, error } = await searchParams;
  const valid = typeof token === "string" && token.length > 0 && !error;
  return (
    <div className="mx-auto max-w-md px-4 py-16 sm:px-6">
      <h1 className="text-3xl font-semibold">Choose a new password</h1>
      <div className="mt-8">
        {valid ? (
          <ResetPasswordForm token={token} />
        ) : (
          <div className="space-y-4">
            <p role="alert" className="rounded-lg bg-gold-100 p-4 text-sm leading-relaxed">
              This link has expired or was already used. Links work for an hour, and only once.
            </p>
            <Button asChild className="w-full">
              <Link href="/forgot-password">Get a new link</Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
