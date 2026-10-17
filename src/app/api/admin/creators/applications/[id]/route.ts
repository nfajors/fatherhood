import { NextResponse } from "next/server";
import { z } from "zod";
import { decideApplication } from "@/lib/creators/applications";
import { fellowNotifier } from "@/lib/creators/runtime";
import { getDb } from "@/lib/db";
import { asAdmin, readJson } from "../../../_shared";

const body = z.object({ decision: z.enum(["approved", "rejected"]), notes: z.string().trim().max(2000).nullable().optional() });

/** Approve or decline a Fellow application; the applicant is emailed. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return asAdmin(async (admin) => {
    const { id } = await params;
    const parsed = await readJson(request, body);
    if (!z.uuid().safeParse(id).success || !parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    const result = await decideApplication(getDb(), { applicationId: id, adminId: admin.id, ...parsed.data }, fellowNotifier());
    return NextResponse.json(result);
  });
}
