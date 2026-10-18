import { desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmailSettingsForm } from "@/components/email/email-settings";
import { ManageBillingButton } from "@/components/manage-billing-button";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { subscriptions } from "@/lib/db/schema";
import { CATEGORY_LABELS } from "@/lib/emails/policy";
import { getPreferences } from "@/lib/emails/preferences";
import { hasActiveMembership } from "@/lib/entitlements";

export const metadata: Metadata = { title: "Your account" };
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect("/sign-in?next=/account");

  const db = getDb();
  const prefs = await getPreferences(db, sessionUser.id);
  const rows = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, sessionUser.id))
    .orderBy(desc(subscriptions.currentPeriodEnd));
  const active = hasActiveMembership(rows);
  const current = rows[0];

  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="text-3xl font-semibold">Hello, {sessionUser.name}</h1>
      <Card className="mt-8">
        <CardTitle>Membership</CardTitle>
        {active && current ? (
          <CardDescription>
            {current.plan === "annual" ? "Annual" : current.plan === "monthly" ? "Monthly" : "Gift"} membership,{" "}
            {current.cancelAtPeriodEnd ? "ends" : "renews"} {current.currentPeriodEnd.toLocaleDateString("en-US", { dateStyle: "long" })}.
          </CardDescription>
        ) : (
          <CardDescription>You don&apos;t have an active membership.</CardDescription>
        )}
        <div className="mt-6 flex flex-wrap gap-3">
          {active ? null : (
            <Button asChild>
              <Link href="/pricing">See plans</Link>
            </Button>
          )}
          {sessionUser.stripeCustomerId ? <ManageBillingButton /> : null}
        </div>
      </Card>
      <Card className="mt-6" id="email">
        <CardTitle>Email</CardTitle>
        <CardDescription className="mb-5">Sent to {sessionUser.email}.</CardDescription>
        <EmailSettingsForm initial={prefs} labels={CATEGORY_LABELS} />
      </Card>
    </div>
  );
}
