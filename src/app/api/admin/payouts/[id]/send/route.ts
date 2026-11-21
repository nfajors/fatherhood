import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { READINESS_LABEL } from "@/lib/payouts/accounts";
import { payoutNotifier, stripePayouts } from "@/lib/payouts/runtime";
import { sendPayout } from "@/lib/payouts/service";
import { asAdmin } from "../../../_shared";

/** Send (or retry) one payout now, ignoring the automatic hold. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return asAdmin(async () => {
    const id = z.uuid().safeParse((await params).id);
    if (!id.success) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const result = await sendPayout(getDb(), stripePayouts, id.data, { manual: true, notifier: payoutNotifier() });
    switch (result.outcome) {
      case "paid":
        return NextResponse.json(result);
      case "not_ready":
        return NextResponse.json({ error: "not_ready", message: `The creator's payout account is not ready (${READINESS_LABEL[result.readiness].toLowerCase()}).` }, { status: 409 });
      case "skipped":
        return NextResponse.json({ error: "not_sendable", message: "This payout is already paid or being sent." }, { status: 409 });
      default:
        return NextResponse.json({ error: result.outcome, message: `Stripe did not send it: ${result.reason}` }, { status: 502 });
    }
  });
}
