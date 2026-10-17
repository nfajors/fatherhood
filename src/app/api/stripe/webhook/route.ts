import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getDb } from "@/lib/db";
import { processedWebhookEvents, subscriptions } from "@/lib/db/schema";
import { stripeEnv } from "@/lib/env";
import { getStripe, toSubscriptionRecord } from "@/lib/stripe";

const SUBSCRIPTION_EVENTS = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
]);

/**
 * Stripe webhook: keeps `subscriptions` in sync, which is what grants access.
 * Each event id is recorded so Stripe's retries are processed once.
 */
export async function POST(request: Request) {
  const env = stripeEnv();
  const stripe = getStripe();
  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, request.headers.get("stripe-signature") ?? "", env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  const db = getDb();
  const prices = { monthly: env.STRIPE_PRICE_MONTHLY, annual: env.STRIPE_PRICE_ANNUAL };

  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(processedWebhookEvents)
      .values({ id: event.id, source: "stripe", type: event.type })
      .onConflictDoNothing()
      .returning({ id: processedWebhookEvents.id });
    if (inserted.length === 0) return; // already handled

    let sub: Stripe.Subscription | null = null;
    if (SUBSCRIPTION_EVENTS.has(event.type)) {
      sub = event.data.object as Stripe.Subscription;
    } else if (event.type === "checkout.session.completed") {
      const checkout = event.data.object as Stripe.Checkout.Session;
      if (checkout.mode === "subscription" && checkout.subscription) {
        const id = typeof checkout.subscription === "string" ? checkout.subscription : checkout.subscription.id;
        sub = await stripe.subscriptions.retrieve(id);
      }
    }
    if (!sub) return;

    // Events can arrive out of order, so always store Stripe's latest state.
    const latest = event.type === "customer.subscription.deleted" ? sub : await stripe.subscriptions.retrieve(sub.id);
    const record = toSubscriptionRecord(latest, prices);
    if (!record) return;

    await tx
      .insert(subscriptions)
      .values(record)
      .onConflictDoUpdate({
        target: subscriptions.stripeSubscriptionId,
        set: {
          status: record.status,
          plan: record.plan,
          stripePriceId: record.stripePriceId,
          currentPeriodEnd: record.currentPeriodEnd,
          cancelAtPeriodEnd: record.cancelAtPeriodEnd,
        },
      });
  });

  return NextResponse.json({ received: true });
}
