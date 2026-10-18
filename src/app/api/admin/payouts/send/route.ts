import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { getMailer } from "@/lib/email";
import { appUrl } from "@/lib/env";
import { getConnectGateway } from "@/lib/payouts/runtime";
import { sendPayouts } from "@/lib/payouts/service";
import { asAdmin, readJson } from "../../_shared";

/** Send payouts now: the given ones, or every one that's ready. */
export async function POST(request: Request) {
  return asAdmin(async () => {
    const parsed = await readJson(request, z.object({ ids: z.array(z.uuid()).max(200).optional() }));
    if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    const result = await sendPayouts(getDb(), getConnectGateway(), { ids: parsed.data.ids, notify: { mailer: getMailer(), appUrl: appUrl() } });
    return NextResponse.json(result);
  });
}
