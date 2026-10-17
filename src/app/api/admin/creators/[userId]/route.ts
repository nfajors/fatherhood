import { NextResponse } from "next/server";
import { revokeFellow } from "@/lib/creators/applications";
import { getDb } from "@/lib/db";
import { asAdmin } from "../../_shared";

/** Remove Fellow (upload) access. Published videos stay up. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ userId: string }> }) {
  return asAdmin(async () => {
    const { userId } = await params;
    await revokeFellow(getDb(), userId);
    return NextResponse.json({ revoked: true });
  });
}
