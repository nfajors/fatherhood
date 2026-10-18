import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { ApplicationError, applyToBeFellow } from "@/lib/creators/applications";
import { getDb } from "@/lib/db";

const body = z.object({
  statement: z.string().trim().min(40, "Tell us a little more: at least 40 characters.").max(3000),
  sampleUrl: z.url("The sample link should be a full web address.").max(500).nullable().or(z.literal("").transform(() => null)),
});

/** Apply for Fellow (upload) access. */
export async function POST(request: Request) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return NextResponse.json({ error: "sign_in_required" }, { status: 401 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request", message: parsed.error.issues[0]?.message }, { status: 400 });
  try {
    const application = await applyToBeFellow(getDb(), sessionUser.id, parsed.data);
    return NextResponse.json({ application: { id: application.id, status: application.status } }, { status: 201 });
  } catch (error) {
    if (error instanceof ApplicationError) return NextResponse.json({ error: error.reason, message: error.message }, { status: 409 });
    throw error;
  }
}
