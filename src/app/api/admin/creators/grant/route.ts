import { NextResponse } from "next/server";
import { z } from "zod";
import { grantFellow } from "@/lib/creators/applications";
import { fellowNotifier } from "@/lib/creators/runtime";
import { getDb } from "@/lib/db";
import { asAdmin, readJson } from "../../_shared";

/** Make an existing account a Fellow (invitations, founding Fellows). */
export async function POST(request: Request) {
  return asAdmin(async (admin) => {
    const parsed = await readJson(request, z.object({ email: z.email("Enter an email address.") }));
    if (!parsed.success) return NextResponse.json({ error: "invalid_request", message: parsed.error.issues[0]?.message }, { status: 400 });
    return NextResponse.json(await grantFellow(getDb(), { email: parsed.data.email, adminId: admin.id }, fellowNotifier()));
  });
}
