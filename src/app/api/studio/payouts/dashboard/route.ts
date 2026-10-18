import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getConnectGateway } from "@/lib/payouts/runtime";
import { dashboardLink, PayoutError } from "@/lib/payouts/service";
import { asCreator } from "../../_shared";

/** A one-time link into the creator's Stripe Express dashboard (payouts, bank details, tax forms). */
export async function POST() {
  return asCreator(async (creator) => {
    try {
      return NextResponse.json({ url: await dashboardLink(getDb(), getConnectGateway(), creator.id) });
    } catch (error) {
      if (error instanceof PayoutError) return NextResponse.json({ error: error.reason, message: error.message }, { status: 409 });
      throw error;
    }
  });
}
