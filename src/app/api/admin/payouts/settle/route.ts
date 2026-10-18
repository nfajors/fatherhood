import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { monthPeriod } from "@/lib/revenue/pool";
import { settlePeriod } from "@/lib/revenue/settlement";
import { asAdmin, readJson } from "../../_shared";

const body = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), force: z.boolean().optional() });

/** Settle (or, with force, recalculate) one month's creator pool. */
export async function POST(request: Request) {
  return asAdmin(async () => {
    const parsed = await readJson(request, body);
    if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    const [year, month] = parsed.data.month.split("-").map(Number) as [number, number];
    const period = monthPeriod(year, month);
    if (period.end > new Date()) return NextResponse.json({ error: "too_early", message: "A month can be settled once it has ended." }, { status: 400 });
    const result = await settlePeriod(getDb(), period, { force: parsed.data.force });
    return NextResponse.json({ alreadySettled: result.alreadySettled, poolCents: result.poolCents, shares: result.shares.length, payouts: result.payouts.length });
  });
}
