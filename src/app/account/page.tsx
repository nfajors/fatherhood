import { desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmailSettingsForm } from "@/components/email/email-settings";
import { PrivacyControls } from "@/components/account/privacy-controls";
import { PasswordLinkButton } from "@/components/auth/password-reset-forms";
import { hasPassword } from "@/lib/account/password-reset";
import { ManageBillingButton } from "@/components/manage-billing-button";
import { SharingControls } from "@/components/organizations/forms";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { subscriptions } from "@/lib/db/schema";
import { CATEGORY_LABELS } from "@/lib/emails/policy";
import { getPreferences } from "@/lib/emails/preferences";
import { hasActiveMembership } from "@/lib/entitlements";
import { membershipsFor } from "@/lib/organizations/service";
import { currentRegion } from "@/lib/region-server";
import { formatDate } from "@/lib/regions";

export const metadata: Metadata = { title: "Your account" };
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect("/sign-in?next=/account");

  const db = getDb();
  const [prefs, orgs, region, withPassword] = await Promise.all([
    getPreferences(db, sessionUser.id),
    membershipsFor(db, sessionUser.id),
    currentRegion(),
    hasPassword(db, sessionUser.id),
  ]);
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
            {{ annual: "Annual", monthly: "Monthly", gift: "Gift", organization: "Organization" }[current.plan]} membership,{" "}
            {current.cancelAtPeriodEnd ? "ends" : "renews"} {formatDate(current.currentPeriodEnd, region.locale, "long")}.
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
      {orgs.length > 0 && (
        <Card className="mt-6" id="organizations">
          <CardTitle>Organizations</CardTitle>
          <ul className="mt-4 space-y-5">
            {orgs.map((o) => (
              <li key={o.id}>
                <p className="font-semibold">{o.orgName}</p>
                {o.isManager ? (
                  <p className="mt-1 text-sm">
                    You manage this organization.{" "}
                    <Link href={`/org/${o.orgSlug}`} className="font-semibold underline-offset-2 hover:underline">
                      Open its page →
                    </Link>
                  </p>
                ) : (
                  <>
                    <p className="mt-1 text-sm text-muted">
                      {o.accessStatus === "active" && o.accessUntil && o.accessUntil > new Date()
                        ? `Your access through ${o.orgName} runs until ${formatDate(new Date(o.accessUntil.getTime() - 1), region.locale, "long")}.`
                        : `Your access through ${o.orgName} isn't active right now.`}
                    </p>
                    <div className="mt-2">
                      <SharingControls memberId={o.id} organization={o.orgName} shares={o.shareProgress} />
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card className="mt-6" id="password">
        <CardTitle>Password</CardTitle>
        <CardDescription className="mb-5">
          {withPassword
            ? "You sign in with your email and password."
            : "You sign in with Google. Set a password to sign in with your email too, for example in the iPhone and Android app."}
        </CardDescription>
        <PasswordLinkButton email={sessionUser.email} hasPassword={withPassword} />
      </Card>
      <Card className="mt-6" id="email">
        <CardTitle>Email</CardTitle>
        <CardDescription className="mb-5">Sent to {sessionUser.email}.</CardDescription>
        <EmailSettingsForm initial={prefs} labels={CATEGORY_LABELS} />
      </Card>
      <Card className="mt-6" id="privacy">
        <CardTitle>Your data</CardTitle>
        <CardDescription className="mb-5">Download a copy of your data, or delete your account.</CardDescription>
        <PrivacyControls />
      </Card>
    </div>
  );
}
