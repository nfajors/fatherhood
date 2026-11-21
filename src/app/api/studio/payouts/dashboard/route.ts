import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { stripePayouts } from "@/lib/payouts/runtime";
import { dashboardLink, PayoutError } from "@/lib/payouts/service";
import { asCreator } from "../../_shared";

/** A one-time sign-in link to the creator's Stripe Express dashboard. */
export async function POST() {
  return asCreator(async (creator) => {
    try {
      return NextResponse.json({ url: await dashboardLink(getDb(), stripePayouts, creator.id) });
    } catch (error) {
      if (error instanceof PayoutError) return NextResponse.json({ error: error.reason, message: error.message }, { status: 409 });
      throw error;
    }
  });
}
