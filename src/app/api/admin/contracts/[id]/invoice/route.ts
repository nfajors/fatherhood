import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { stripeOrgBilling } from "@/lib/organizations/runtime";
import { sendContractInvoice } from "@/lib/organizations/service";
import { orgErrorResponse } from "../../../../org/_shared";
import { asAdmin } from "../../../_shared";

/** Create, finalize and email the contract's Stripe invoice. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return asAdmin(async () => {
    const id = z.uuid().safeParse((await params).id);
    if (!id.success) return NextResponse.json({ error: "not_found" }, { status: 404 });
    try {
      await sendContractInvoice(getDb(), stripeOrgBilling, id.data);
      return NextResponse.json({ sent: true });
    } catch (error) {
      return orgErrorResponse(error);
    }
  });
}
