import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { appUrl } from "@/lib/env";
import { stripePayouts } from "@/lib/payouts/runtime";
import { getPayoutAccount, startOnboarding } from "@/lib/payouts/service";
import { asCreator } from "../../_shared";
import { onboardingUrls } from "../_shared";

/** Start or continue Stripe onboarding for payouts; returns the link to send the creator to. */
export async function POST() {
  return asCreator(async (creator) => {
    const url = await startOnboarding(getDb(), stripePayouts, creator, onboardingUrls());
    return NextResponse.json({ url });
  });
}

/**
 * Stripe's refresh_url: an onboarding link expired or was already used, so make a new
 * one and go straight there. Only continues an account that already exists.
 */
export async function GET() {
  const creator = await getSessionUser();
  if (!creator) return NextResponse.redirect(`${appUrl()}/sign-in?next=/studio/earnings`);
  if (creator.role === "user" || !(await getPayoutAccount(getDb(), creator.id))) {
    return NextResponse.redirect(`${appUrl()}/studio/earnings`);
  }
  return NextResponse.redirect(await startOnboarding(getDb(), stripePayouts, creator, onboardingUrls()));
}
