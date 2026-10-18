import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getDb } from "@/lib/db";
import { toAccountState } from "@/lib/payouts/gateway";
import { applyAccountState, markDisconnected } from "@/lib/payouts/service";
import { getStripe } from "@/lib/stripe";

/**
 * Stripe Connect webhook (events from creators' connected accounts): keeps
 * payout accounts in sync as Stripe verifies them or asks for more details.
 * Separate endpoint and secret from the platform webhook, as Stripe requires.
 * Handlers are idempotent (they store Stripe's latest state), so retries are harmless.
 */
export async function POST(request: Request) {
  const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(await request.text(), request.headers.get("stripe-signature") ?? "", secret);
  } catch {
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }
  const db = getDb();
  if (event.type === "account.updated") {
    await applyAccountState(db, toAccountState(event.data.object));
  } else if (event.type === "account.application.deauthorized" && event.account) {
    await markDisconnected(db, event.account);
  }
  return NextResponse.json({ received: true });
}
