import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { appUrl } from "@/lib/env";
import { getStripe } from "@/lib/stripe";

/** Open the Stripe customer portal so members can manage billing or cancel. */
export async function POST() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return NextResponse.json({ error: "sign_in_required" }, { status: 401 });
  if (!sessionUser.stripeCustomerId) return NextResponse.json({ error: "no_billing_account" }, { status: 404 });

  const portal = await getStripe().billingPortal.sessions.create({
    customer: sessionUser.stripeCustomerId,
    return_url: `${appUrl()}/account`,
  });
  return NextResponse.json({ url: portal.url });
}
