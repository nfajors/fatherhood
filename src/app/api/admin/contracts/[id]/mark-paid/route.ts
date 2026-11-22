import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { markContractPaid } from "@/lib/organizations/service";
import { orgErrorResponse } from "../../../../org/_shared";
import { asAdmin, readJson } from "../../../_shared";

const body = z.object({ note: z.string().trim().min(1, "Say how it was paid.").max(500) });

/** Record a draft contract paid without a Stripe invoice (check, wire, or free). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return asAdmin(async () => {
    const id = z.uuid().safeParse((await params).id);
    if (!id.success) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const parsed = await readJson(request, body);
    if (!parsed.success) return NextResponse.json({ error: "invalid", message: parsed.error.issues[0]?.message }, { status: 400 });
    try {
      await markContractPaid(getDb(), { contractId: id.data, note: parsed.data.note });
      return NextResponse.json({ paid: true });
    } catch (error) {
      return orgErrorResponse(error);
    }
  });
}
