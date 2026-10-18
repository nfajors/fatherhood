import { NextResponse } from "next/server";
import { z } from "zod";
import { getMailer } from "@/lib/email";
import { previewEmail } from "@/lib/emails/admin";
import { SEQUENCE_IDS } from "@/lib/emails/sequences";
import { appUrl } from "@/lib/env";
import { asAdmin, readJson } from "../../_shared";

const body = z.object({ sequence: z.enum(SEQUENCE_IDS as [string, ...string[]]), step: z.string().max(64), variant: z.enum(["new", "progress"]) });

/** Send a sample of one sequence email to the admin asking. */
export async function POST(request: Request) {
  return asAdmin(async (admin) => {
    const parsed = await readJson(request, body);
    if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    const { sequence, step, variant } = parsed.data;
    const message = previewEmail(sequence as (typeof SEQUENCE_IDS)[number], step, variant, appUrl(), admin.email, admin.id);
    if (!message) return NextResponse.json({ error: "nothing_to_send", message: "This email is skipped for that sample." }, { status: 400 });
    await getMailer().send({ ...message, subject: `[Test] ${message.subject}` });
    return NextResponse.json({ to: admin.email });
  });
}
