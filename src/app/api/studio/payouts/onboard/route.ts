import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { appUrl } from "@/lib/env";
import { getConnectGateway } from "@/lib/payouts/runtime";
import { startOnboarding } from "@/lib/payouts/service";
import { asCreator } from "../../_shared";

const urls = () => ({ refreshUrl: `${appUrl()}/api/studio/payouts/onboard`, returnUrl: `${appUrl()}/api/studio/payouts/return` });

/** Start (or continue) Stripe onboarding: returns the link to send the creator to. */
export async function POST() {
  return asCreator(async (creator) => {
    const url = await startOnboarding(getDb(), getConnectGateway(), creator, urls());
    return NextResponse.json({ url });
  });
}

/** Stripe's refresh_url: onboarding links are single-use, so make a fresh one and go there. */
export async function GET() {
  const sessionUser = await getSessionUser();
  if (!sessionUser || sessionUser.role === "user") return NextResponse.redirect(`${appUrl()}/studio/earnings`, 303);
  const url = await startOnboarding(getDb(), getConnectGateway(), sessionUser, urls());
  return NextResponse.redirect(url, 303);
}
