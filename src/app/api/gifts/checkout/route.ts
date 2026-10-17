import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { GIFT_MESSAGE_MAX_CHARS, GIFT_TERMS, PLANS, SITE } from "@/lib/config";
import { getDb } from "@/lib/db";
import { appUrl } from "@/lib/env";
import { attachCheckoutSession, createPendingGift } from "@/lib/gifts/service";
import { getStripe } from "@/lib/stripe";

const DAY_MS = 24 * 60 * 60 * 1000;

const body = z
  .object({
    plan: z.enum(["annual", "monthly"]),
    purchaserName: z.string().trim().min(1).max(60),
    purchaserEmail: z.email().max(254),
    recipientName: z.string().trim().min(1).max(60),
    delivery: z.enum(["email", "self"]),
    recipientEmail: z.email().max(254).optional(),
    message: z.string().trim().max(GIFT_MESSAGE_MAX_CHARS).optional(),
    /** ISO timestamp chosen in the buyer's time zone; omitted for "send now". */
    deliverAt: z.iso.datetime({ offset: true }).optional(),
  })
  .refine((b) => b.delivery !== "email" || b.recipientEmail, { path: ["recipientEmail"], message: "Recipient email is required" })
  .refine(
    (b) => {
      if (!b.deliverAt) return true;
      const at = Date.parse(b.deliverAt);
      return at > Date.now() - DAY_MS && at < Date.now() + 366 * DAY_MS;
    },
    { path: ["deliverAt"], message: "Choose a delivery date within the next year" },
  );

/** Create a pending gift and a one-time Stripe Checkout payment for it. No account needed. */
export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
  const input = parsed.data;
  const sessionUser = await getSessionUser().catch(() => null);

  const db = getDb();
  const gift = await createPendingGift(db, {
    plan: input.plan,
    purchaserUserId: sessionUser?.id ?? null,
    purchaserName: input.purchaserName,
    purchaserEmail: input.purchaserEmail,
    recipientName: input.recipientName,
    delivery: input.delivery,
    recipientEmail: input.recipientEmail ?? null,
    message: input.message || null,
    deliverAt: input.deliverAt ? new Date(input.deliverAt) : null,
  });

  const term = GIFT_TERMS[input.plan].label;
  const metadata = { kind: "gift", giftId: gift.id };
  const checkout = await getStripe().checkout.sessions.create(
    {
      mode: "payment",
      customer_email: input.purchaserEmail,
      client_reference_id: gift.id,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: PLANS[input.plan].amountCents,
            product_data: {
              name: `${SITE.name} gift membership: ${term}`,
              description: `For ${input.recipientName}. Starts when they redeem it.`,
            },
          },
        },
      ],
      metadata,
      payment_intent_data: { metadata },
      success_url: `${appUrl()}/gift/thanks?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl()}/gift`,
    },
    { idempotencyKey: `gift-checkout-${gift.id}` },
  );
  await attachCheckoutSession(db, gift.id, checkout.id);

  return NextResponse.json({ url: checkout.url });
}
