import { eq } from "drizzle-orm";
import { after, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getDb } from "@/lib/db";
import { processedWebhookEvents, revenueLedger, subscriptions, user } from "@/lib/db/schema";
import { stripeEnv } from "@/lib/env";
import { recordGiftPayment, sendGiftEmails, stripeCredits } from "@/lib/gifts/runtime";
import { refundGiftPayment } from "@/lib/gifts/service";
import { getStripe, toLedgerEntry, toSubscriptionRecord } from "@/lib/stripe";

const SUBSCRIPTION_EVENTS = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
]);

/**
 * Stripe webhook: keeps `subscriptions` in sync, which is what grants access,
 * records paid subscription invoices in the revenue ledger that funds the
 * creator pool, and fulfils and refunds gift memberships. Each event id is
 * recorded so Stripe's retries are processed once.
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

  // Gift handlers are idempotent on their own, so they run before (not inside) the
  // processed-event record: if one throws, Stripe gets a 500 and retries.
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const paid = await recordGiftPayment(event.data.object as Stripe.Checkout.Session);
    if (paid) {
      after(() => sendGiftEmails(paid));
      return NextResponse.json({ received: true });
    }
  }
  if (event.type === "charge.refunded") {
    const charge = event.data.object as Stripe.Charge;
    const paymentIntentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
    if (paymentIntentId) {
      await refundGiftPayment(getDb(), { paymentIntentId, fullyRefunded: charge.refunded }, stripeCredits);
    }
    return NextResponse.json({ received: true });
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

    if (event.type === "invoice.paid") {
      const entry = toLedgerEntry(event.data.object as Stripe.Invoice);
      if (!entry) return;
      const owner = await tx.query.user.findFirst({
        where: eq(user.stripeCustomerId, entry.stripeCustomerId),
        columns: { id: true },
      });
      await tx
        .insert(revenueLedger)
        .values({
          kind: "subscription_invoice",
          stripeObjectId: entry.stripeInvoiceId,
          userId: owner?.id ?? null,
          amountCents: entry.amountCents,
          occurredAt: entry.paidAt,
        })
        .onConflictDoNothing();
      return;
    }

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
