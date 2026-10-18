import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { requeuePayout } from "@/lib/payouts/service";
import { asAdmin } from "../../../_shared";

/** Put a failed payout back in the queue (the next send picks it up). */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return asAdmin(async () => {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "not_found" }, { status: 404 });
    await requeuePayout(getDb(), id);
    return NextResponse.json({ ok: true });
  });
}
