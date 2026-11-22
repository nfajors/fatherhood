import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { setJoinCode } from "@/lib/organizations/service";
import { readJson } from "../../../admin/_shared";
import { asOrgManager } from "../../_shared";

const body = z.object({ enabled: z.boolean(), rotate: z.boolean().optional() });

/** Turn the shared join code on or off, or replace it with a new one. */
export async function POST(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  return asOrgManager((await params).orgId, async ({ org }) => {
    const parsed = await readJson(request, body);
    if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
    const updated = await setJoinCode(getDb(), org.id, parsed.data);
    return NextResponse.json({ joinCode: updated.joinCode, enabled: updated.joinCodeEnabled });
  });
}
