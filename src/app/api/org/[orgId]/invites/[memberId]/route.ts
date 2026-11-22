import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { revokeInvitation } from "@/lib/organizations/service";
import { asOrgManager } from "../../../_shared";

/** Withdraw an invitation that hasn't been used. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ orgId: string; memberId: string }> }) {
  const { orgId, memberId } = await params;
  return asOrgManager(orgId, async ({ org }) => {
    const id = z.uuid().safeParse(memberId);
    if (!id.success) return NextResponse.json({ error: "not_found" }, { status: 404 });
    await revokeInvitation(getDb(), org.id, id.data);
    return NextResponse.json({ revoked: true });
  });
}
