import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { removeMember } from "@/lib/organizations/service";
import { asOrgManager } from "../../../_shared";

/** Remove a father or manager from the organization. His own account and progress stay. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ orgId: string; memberId: string }> }) {
  const { orgId, memberId } = await params;
  return asOrgManager(orgId, async ({ org }) => {
    const id = z.uuid().safeParse(memberId);
    if (!id.success) return NextResponse.json({ error: "not_found" }, { status: 404 });
    await removeMember(getDb(), { orgId: org.id, memberId: id.data });
    return NextResponse.json({ removed: true });
  });
}
