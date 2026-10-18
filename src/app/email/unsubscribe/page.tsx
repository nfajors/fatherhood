import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { EmailSettingsForm, UnsubscribeButton } from "@/components/email/email-settings";
import { Card } from "@/components/ui/card";
import { getDb } from "@/lib/db";
import { emailCategory, user, type EmailCategory } from "@/lib/db/schema";
import { CATEGORY_LABELS } from "@/lib/emails/policy";
import { getPreferences } from "@/lib/emails/preferences";
import { verifyEmailToken } from "@/lib/emails/tokens";

export const metadata: Metadata = { title: "Email settings", robots: { index: false } };
export const dynamic = "force-dynamic";

const asCategory = (value: string | undefined): EmailCategory | null =>
  (emailCategory.enumValues as readonly string[]).includes(value ?? "") ? (value as EmailCategory) : null;

/** Where an email's "Unsubscribe" and "Email settings" links land. Works without signing in. */
export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ t?: string; c?: string; done?: string }> }) {
  const { t, c, done } = await searchParams;
  const userId = verifyEmailToken(t);
  if (!t || !userId) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 sm:px-6">
        <h1 className="text-3xl font-semibold">This link isn&apos;t valid</h1>
        <p className="mt-3 text-muted">
          It may have been cut short when it was copied.{" "}
          <Link href="/sign-in?next=/account" className="underline">
            Sign in
          </Link>{" "}
          to change your email settings from your account.
        </p>
      </div>
    );
  }
  const db = getDb();
  const [person] = await db.select({ email: user.email }).from(user).where(eq(user.id, userId));
  if (!person) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 sm:px-6">
        <h1 className="text-3xl font-semibold">Account not found</h1>
        <p className="mt-3 text-muted">This account has been deleted, so it won&apos;t get any more email.</p>
      </div>
    );
  }
  const prefs = await getPreferences(db, userId);
  const asked = asCategory(c);
  const finished = asCategory(done);

  return (
    <div className="mx-auto max-w-xl px-4 py-16 sm:px-6">
      <h1 className="text-3xl font-semibold">Email settings</h1>
      <p className="mt-2 text-muted">For {person.email}</p>

      {finished && (
        <p role="status" className="mt-6 rounded-lg bg-green-50 p-4 text-green-900">
          Done. You won&apos;t get &quot;{CATEGORY_LABELS[finished].label}&quot; emails any more.
        </p>
      )}
      {asked && !finished && (
        <Card className="mt-6">
          {prefs[asked] ? (
            <>
              <p className="mb-4">{CATEGORY_LABELS[asked].description}</p>
              <UnsubscribeButton token={t} category={asked} label={CATEGORY_LABELS[asked].label} />
            </>
          ) : (
            <p>You&apos;re already unsubscribed from &quot;{CATEGORY_LABELS[asked].label}&quot;.</p>
          )}
        </Card>
      )}

      <Card className="mt-6">
        <h2 className="mb-4 text-lg font-semibold">Emails you get</h2>
        <EmailSettingsForm key={JSON.stringify(prefs)} initial={prefs} labels={CATEGORY_LABELS} token={t} />
      </Card>
    </div>
  );
}
