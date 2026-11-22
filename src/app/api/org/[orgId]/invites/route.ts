import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { getMailer } from "@/lib/email";
import { appUrl } from "@/lib/env";
import { parseEmails } from "@/lib/organizations/codes";
import { inviteMembers, sendInvitations } from "@/lib/organizations/service";
import { readJson } from "../../../admin/_shared";
import { asOrgManager } from "../../_shared";

const body = z.object({ emails: z.string().max(20_000), asManager: z.boolean().optional() });

/** Invite fathers (or managers) by email: a pasted list, one link each. */
export async function POST(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  return asOrgManager((await params).orgId, async ({ user, org }) => {
    const parsed = await readJson(request, body);
    if (!parsed.success) return NextResponse.json({ error: "invalid", message: "Paste one or more email addresses." }, { status: 400 });
    const { valid, invalid } = parseEmails(parsed.data.emails);
    const asManager = parsed.data.asManager ?? false;
    const db = getDb();
    const result = await inviteMembers(db, { orgId: org.id, emails: valid, asManager, invitedById: user.id });
    const { failed } = await sendInvitations(getMailer(), { organization: org.name, asManager, appUrl: appUrl(), invited: result.invited });
    return NextResponse.json({ invited: result.invited.length - failed.length, alreadyJoined: result.alreadyJoined, invalid, failed });
  });
}
