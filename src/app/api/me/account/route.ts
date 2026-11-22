import { NextResponse } from "next/server";
import { z } from "zod";
import { AccountError, deleteAccount } from "@/lib/account/privacy";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getStripe } from "@/lib/stripe";

const body = z.object({ confirmation: z.string().max(20) });

/** Delete your account: cancels billing, then removes the account and what belongs to it. */
export async function DELETE(request: Request) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return NextResponse.json({ error: "sign_in_required" }, { status: 401 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "confirm", message: "Type DELETE to confirm." }, { status: 400 });
  try {
    await deleteAccount(getDb(), { cancel: async (id) => void (await getStripe().subscriptions.cancel(id)) }, { userId: sessionUser.id, confirmation: parsed.data.confirmation });
  } catch (error) {
    if (error instanceof AccountError) return NextResponse.json({ error: error.reason, message: error.message }, { status: error.reason === "fellow_with_content" ? 409 : 400 });
    throw error;
  }
  const res = NextResponse.json({ deleted: true });
  // The session went with the account; clear its cookies too.
  for (const name of ["better-auth.session_token", "__Secure-better-auth.session_token", "better-auth.session_data", "__Secure-better-auth.session_data"]) res.cookies.delete(name);
  return res;
}
