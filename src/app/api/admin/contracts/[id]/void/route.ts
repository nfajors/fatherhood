import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { stripeOrgBilling } from "@/lib/organizations/runtime";
import { voidContract } from "@/lib/organizations/service";
import { orgErrorResponse } from "../../../../org/_shared";
import { asAdmin } from "../../../_shared";

/** Cancel an unpaid contract (voiding its Stripe invoice); its seats lose access. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return asAdmin(async () => {
    const id = z.uuid().safeParse((await params).id);
    if (!id.success) return NextResponse.json({ error: "not_found" }, { status: 404 });
    try {
      await voidContract(getDb(), stripeOrgBilling, id.data);
      return NextResponse.json({ voided: true });
    } catch (error) {
      return orgErrorResponse(error);
    }
  });
}
