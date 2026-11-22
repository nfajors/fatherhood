import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { createContract } from "@/lib/organizations/service";
import { orgErrorResponse } from "../../../../org/_shared";
import { asAdmin, readJson } from "../../../_shared";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a full date.");
const body = z.object({
  seats: z.number().int().min(1).max(100_000),
  pricePerSeatCents: z.number().int().min(0).max(10_000_00),
  startsOn: date,
  /** The last day of access (inclusive). */
  endsOn: date,
  daysUntilDue: z.number().int().min(0).max(120).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

/** A draft contract: seats for a term at a price per seat. Nothing is sent until "Send invoice". */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return asAdmin(async (admin) => {
    const id = z.uuid().safeParse((await params).id);
    if (!id.success) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const parsed = await readJson(request, body);
    if (!parsed.success) return NextResponse.json({ error: "invalid", message: parsed.error.issues[0]?.message }, { status: 400 });
    const { startsOn, endsOn, ...rest } = parsed.data;
    const startsAt = new Date(`${startsOn}T00:00:00Z`);
    // Access runs through the whole last day.
    const endsAt = new Date(new Date(`${endsOn}T00:00:00Z`).getTime() + 24 * 3_600_000);
    try {
      const contract = await createContract(getDb(), { orgId: id.data, startsAt, endsAt, createdById: admin.id, ...rest });
      return NextResponse.json({ id: contract.id });
    } catch (error) {
      return orgErrorResponse(error);
    }
  });
}
