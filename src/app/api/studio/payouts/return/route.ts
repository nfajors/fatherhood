import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { appUrl } from "@/lib/env";
import { getConnectGateway } from "@/lib/payouts/runtime";
import { refreshAccount } from "@/lib/payouts/service";

/** Stripe's return_url after onboarding: pull the account's state now (the webhook may lag), then back to Earnings. */
export async function GET() {
  const sessionUser = await getSessionUser();
  if (sessionUser) {
    await refreshAccount(getDb(), getConnectGateway(), sessionUser.id).catch((error) => console.error("Payout account refresh failed:", error));
  }
  return NextResponse.redirect(`${appUrl()}/studio/earnings?payouts=updated#payouts`, 303);
}
