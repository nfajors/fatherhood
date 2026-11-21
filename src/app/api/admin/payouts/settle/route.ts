import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { monthPeriod } from "@/lib/revenue/pool";
import { settlePeriod } from "@/lib/revenue/settlement";
import { asAdmin, readJson } from "../../_shared";

const body = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Expected YYYY-MM.") });

/** Settle a month that has ended (the same as `npm run revenue:settle`; re-running returns the stored result). */
export async function POST(request: Request) {
  return asAdmin(async () => {
    const parsed = await readJson(request, body);
    if (!parsed.success) return NextResponse.json({ error: "invalid", message: parsed.error.issues[0]?.message }, { status: 400 });
    const [year, month] = parsed.data.month.split("-").map(Number) as [number, number];
    const period = monthPeriod(year, month);
    if (period.end > new Date()) return NextResponse.json({ error: "invalid", message: "That month hasn't ended yet." }, { status: 400 });
    const result = await settlePeriod(getDb(), period);
    return NextResponse.json({ alreadySettled: result.alreadySettled, poolCents: result.poolCents, payouts: result.payouts.length });
  });
}
