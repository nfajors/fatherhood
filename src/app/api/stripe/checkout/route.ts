import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { MONEY_BACK_GUARANTEE_DAYS } from "@/lib/config";
import { getDb } from "@/lib/db";
import { user } from "@/lib/db/schema";
import { appUrl } from "@/lib/env";
import { getStripe, priceIdFor } from "@/lib/stripe";

const body = z.object({ plan: z.enum(["monthly", "annual"]) });

/** Start a Stripe Checkout session for a membership. */
export async function POST(request: Request) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return NextResponse.json({ error: "sign_in_required" }, { status: 401 });

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_plan" }, { status: 400 });

  const stripe = getStripe();
  let customerId = sessionUser.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create(
      { email: sessionUser.email, name: sessionUser.name, metadata: { userId: sessionUser.id } },
      { idempotencyKey: `customer-${sessionUser.id}` },
    );
    customerId = customer.id;
    await getDb().update(user).set({ stripeCustomerId: customerId }).where(eq(user.id, sessionUser.id));
  }

  const metadata = { userId: sessionUser.id, plan: parsed.data.plan };
  const checkout = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: sessionUser.id,
    line_items: [{ price: priceIdFor(parsed.data.plan), quantity: 1 }],
    allow_promotion_codes: true, // book-buyer codes
    metadata,
    subscription_data: { metadata },
    custom_text: {
      submit: { message: `${MONEY_BACK_GUARANTEE_DAYS}-day money-back guarantee.` },
    },
    success_url: `${appUrl()}/welcome?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl()}/pricing`,
  });

  return NextResponse.json({ url: checkout.url });
}
