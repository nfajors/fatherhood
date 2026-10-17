import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { stripeCredits } from "@/lib/gifts/runtime";
import { GiftError, redeemGift } from "@/lib/gifts/service";

const body = z.object({ code: z.string().trim().min(1).max(40) });

/** Redeem a gift code on the signed-in account. */
export async function POST(request: Request) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return NextResponse.json({ error: "sign_in_required" }, { status: 401 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_code", message: "Enter your gift code." }, { status: 400 });

  try {
    const result = await redeemGift(
      getDb(),
      { code: parsed.data.code, user: { id: sessionUser.id, stripeCustomerId: sessionUser.stripeCustomerId } },
      stripeCredits,
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof GiftError) {
      return NextResponse.json({ error: error.reason, message: error.message }, { status: error.reason === "invalid_code" ? 404 : 409 });
    }
    throw error;
  }
}
