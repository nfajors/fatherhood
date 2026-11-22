import { eq } from "drizzle-orm";
import { after, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getDb } from "@/lib/db";
import { processedWebhookEvents, revenueLedger, subscriptions, user } from "@/lib/db/schema";
import { stripeEnv } from "@/lib/env";
import { recordGiftPayment, sendGiftEmails, stripeCredits } from "@/lib/gifts/runtime";
import { refundGiftPayment } from "@/lib/gifts/service";
import { recordContractPaid, recordInvoiceVoided } from "@/lib/organizations/service";
import { contractIdFromInvoice } from "@/lib/organizations/runtime";
import { recordTransferReversal } from "@/lib/payouts/service";
import { getStripe, settledUsdForInvoice, toLedgerEntry, toSubscriptionRecord } from "@/lib/stripe";

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
 * creator pool, fulfils and refunds gift memberships, records organization contract
 * invoices as paid or voided, and notices creator payout transfers reversed in Stripe. Each event id is
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

  // Organization contract invoices: idempotent on their own, like gifts.
  if (event.type === "invoice.paid" || event.type === "invoice.voided") {
    const invoice = event.data.object as Stripe.Invoice;
    const contractId = contractIdFromInvoice(invoice);
    if (contractId) {
      if (event.type === "invoice.paid") {
        const paidAt = new Date((invoice.status_transitions?.paid_at ?? event.created) * 1000);
        // A check or wire marked paid in Stripe ("paid out of band") can report nothing in amount_paid.
        const amountPaidCents = invoice.amount_paid > 0 ? invoice.amount_paid : invoice.total;
        await recordContractPaid(getDb(), { contractId, stripeInvoiceId: invoice.id!, amountPaidCents, paidAt });
      } else {
        await recordInvoiceVoided(getDb(), invoice.id!);
      }
      return NextResponse.json({ received: true });
    }
  }

  if (event.type === "transfer.reversed") {
    const transfer = event.data.object as Stripe.Transfer;
    await recordTransferReversal(getDb(), { id: transfer.id, amountCents: transfer.amount, amountReversedCents: transfer.amount_reversed });
    return NextResponse.json({ received: true });
  }

  const db = getDb();
  const prices = { monthly: env.STRIPE_PRICE_MONTHLY, annual: env.STRIPE_PRICE_ANNUAL };

  // A paid invoice in another currency is recorded at the US dollars Stripe settled it for
  // (the creator pool shares settled dollars). Looked up before the transaction; if the
  // settlement isn't available yet, Stripe gets a 500 and retries.
  let ledger: (NonNullable<ReturnType<typeof toLedgerEntry>> & { usdCents: number }) | null = null;
  if (event.type === "invoice.paid") {
    const entry = toLedgerEntry(event.data.object as Stripe.Invoice);
    if (entry) {
      const usdCents = entry.currency === "usd" ? entry.amountCents : await settledUsdForInvoice(entry.stripeInvoiceId);
      if (usdCents === null) return NextResponse.json({ error: "settlement_not_ready" }, { status: 500 });
      ledger = { ...entry, usdCents };
    }
  }

  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(processedWebhookEvents)
      .values({ id: event.id, source: "stripe", type: event.type })
      .onConflictDoNothing()
      .returning({ id: processedWebhookEvents.id });
    if (inserted.length === 0) return; // already handled

    if (event.type === "invoice.paid") {
      const entry = ledger;
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
          amountCents: entry.usdCents,
          currency: entry.currency,
          originalAmountCents: entry.amountCents,
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
          currency: record.currency,
        },
      });
  });

  return NextResponse.json({ received: true });
}
