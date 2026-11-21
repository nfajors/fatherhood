import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getDb } from "@/lib/db";
import { processedWebhookEvents } from "@/lib/db/schema";
import { connectWebhookSecret, stripePayouts } from "@/lib/payouts/runtime";
import { markAccountDisconnected, syncPayoutAccount } from "@/lib/payouts/service";
import { getStripe } from "@/lib/stripe";

/**
 * Stripe Connect webhook (events on creators' connected accounts): keeps each
 * payout account's readiness in sync. Register it in Stripe as a Connect endpoint
 * ("Events on connected accounts") for account.updated and
 * account.application.deauthorized, with its own STRIPE_CONNECT_WEBHOOK_SECRET.
 */
export async function POST(request: Request) {
  const secret = connectWebhookSecret();
  if (!secret) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, request.headers.get("stripe-signature") ?? "", secret);
  } catch {
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  const db = getDb();
  if (event.type === "account.updated") {
    // Events can arrive out of order, so store Stripe's latest state rather than the event's.
    const account = event.data.object as Stripe.Account;
    await syncPayoutAccount(db, await stripePayouts.retrieveAccount(account.id));
  } else if (event.type === "account.application.deauthorized" && event.account) {
    const inserted = await db
      .insert(processedWebhookEvents)
      .values({ id: event.id, source: "stripe_connect", type: event.type })
      .onConflictDoNothing()
      .returning({ id: processedWebhookEvents.id });
    if (inserted.length > 0) await markAccountDisconnected(db, event.account, new Date(event.created * 1000));
  }
  return NextResponse.json({ received: true });
}
