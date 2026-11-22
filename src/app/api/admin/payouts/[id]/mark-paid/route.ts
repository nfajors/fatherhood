import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { markPayoutPaidManually } from "@/lib/payouts/service";
import { asAdmin, readJson } from "../../../_shared";

const body = z.object({ note: z.string().trim().min(1, "Say how it was paid.").max(500) });

/** Record a payout paid outside Stripe Connect. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return asAdmin(async (admin) => {
    const id = z.uuid().safeParse((await params).id);
    if (!id.success) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const parsed = await readJson(request, body);
    if (!parsed.success) return NextResponse.json({ error: "invalid", message: parsed.error.issues[0]?.message }, { status: 400 });
    await markPayoutPaidManually(getDb(), { payoutId: id.data, adminId: admin.id, note: parsed.data.note });
    return NextResponse.json({ paid: true });
  });
}
