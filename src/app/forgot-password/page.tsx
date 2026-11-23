import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/auth/password-reset-forms";

export const metadata: Metadata = { title: "Forgot your password?", robots: { index: false } };

export default async function Page({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const { email } = await searchParams;
  return (
    <div className="mx-auto max-w-md px-4 py-16 sm:px-6">
      <h1 className="text-3xl font-semibold">Forgot your password?</h1>
      <p className="mt-3 text-muted">
        Enter the email you signed up with and we&apos;ll send a link to choose a new one. Signed up with Google? This sets a
        password too, so you can sign in to the iPhone and Android app.
      </p>
      <div className="mt-8">
        <ForgotPasswordForm initialEmail={typeof email === "string" ? email.slice(0, 200) : ""} />
      </div>
    </div>
  );
}
