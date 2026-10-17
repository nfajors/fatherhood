import type { Metadata } from "next";
import Link from "next/link";
import { after } from "next/server";
import { Button } from "@/components/ui/button";
import { GIFT_TERMS, type PlanId } from "@/lib/config";
import { getDb } from "@/lib/db";
import { appUrl } from "@/lib/env";
import { redeemUrl } from "@/lib/gifts/emails";
import { recordGiftPayment, sendGiftEmails } from "@/lib/gifts/runtime";
import { getGiftByCheckoutSession } from "@/lib/gifts/service";
import { getStripe } from "@/lib/stripe";

export const metadata: Metadata = { title: "Thank you for your gift", robots: { index: false } };
export const dynamic = "force-dynamic";

const formatDate = (date: Date) => date.toLocaleDateString("en-US", { dateStyle: "long" });

export default async function GiftThanksPage({ searchParams }: { searchParams: Promise<{ session_id?: string }> }) {
  const { session_id: sessionId } = await searchParams;
  const db = getDb();
  let gift = sessionId ? await getGiftByCheckoutSession(db, sessionId) : undefined;

  // If we get here before Stripe's webhook, confirm the payment directly.
  if (gift?.status === "pending_payment" && sessionId) {
    const paid = await recordGiftPayment(await getStripe().checkout.sessions.retrieve(sessionId));
    if (paid) {
      gift = paid;
      after(() => sendGiftEmails(paid));
    }
  }

  if (!gift) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center sm:px-6">
        <h1 className="text-3xl font-semibold">We couldn&apos;t find that gift</h1>
        <p className="mt-4 text-muted">If you completed a payment, your receipt and gift code are on their way by email.</p>
      </div>
    );
  }

  if (gift.status === "pending_payment") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center sm:px-6">
        <h1 className="text-3xl font-semibold">Confirming your payment...</h1>
        <p className="mt-4 text-muted">This can take a minute. Refresh this page, or watch for our email with the gift code.</p>
      </div>
    );
  }

  if (gift.status === "refunded") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center sm:px-6">
        <h1 className="text-3xl font-semibold">This gift was refunded</h1>
        <p className="mt-4 text-muted">Its code no longer works. Questions? Reply to your receipt email.</p>
      </div>
    );
  }

  const term = GIFT_TERMS[gift.plan as PlanId].label;
  const delivery =
    gift.delivery === "self"
      ? `Share this code with ${gift.recipientName} however you like.`
      : gift.deliverAt && gift.deliverAt > new Date()
        ? `We'll email it to ${gift.recipientName} on ${formatDate(gift.deliverAt)}.`
        : `We're emailing it to ${gift.recipientName} now.`;

  return (
    <div className="mx-auto max-w-2xl px-4 py-20 text-center sm:px-6">
      <p className="text-sm font-semibold uppercase tracking-widest text-gold-600">Thank you</p>
      <h1 className="mt-3 text-4xl font-semibold">
        You gave {gift.recipientName} {term} of Fatherhood.School
      </h1>
      <p className="mt-4 text-lg text-muted">{delivery} A copy of the code is in your email too.</p>
      <div className="mx-auto mt-10 max-w-md rounded-xl border-2 border-gold-500 bg-white p-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted">Gift code</p>
        <p className="mt-2 font-mono text-2xl font-bold text-navy-900">{gift.code}</p>
        <p className="mt-3 break-all text-sm text-muted">{redeemUrl(appUrl(), gift.code)}</p>
      </div>
      <Button asChild variant="outline" className="mt-10">
        <Link href="/gift">Give another gift</Link>
      </Button>
    </div>
  );
}
