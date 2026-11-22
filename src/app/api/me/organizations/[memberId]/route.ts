import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { leaveOrganization, setSharing } from "@/lib/organizations/service";
import { readJson } from "../../../admin/_shared";
import { asSignedIn } from "../../../org/_shared";

const body = z.object({ share: z.boolean() });

/** Change whether the organization sees your name and progress. */
export async function PATCH(request: Request, { params }: { params: Promise<{ memberId: string }> }) {
  const memberId = z.uuid().safeParse((await params).memberId);
  return asSignedIn(async (user) => {
    const parsed = await readJson(request, body);
    if (!memberId.success || !parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
    await setSharing(getDb(), { userId: user.id, memberId: memberId.data, share: parsed.data.share });
    return NextResponse.json({ saved: true });
  });
}

/** Leave the organization. Your account and progress stay; the organization's access ends. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ memberId: string }> }) {
  const memberId = z.uuid().safeParse((await params).memberId);
  return asSignedIn(async (user) => {
    if (!memberId.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
    await leaveOrganization(getDb(), { userId: user.id, memberId: memberId.data });
    return NextResponse.json({ left: true });
  });
}
