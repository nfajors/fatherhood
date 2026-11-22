import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { acceptInvitation } from "@/lib/organizations/service";
import { readJson } from "../../admin/_shared";
import { asSignedIn } from "../../org/_shared";

const body = z.object({ token: z.string().min(10).max(200), share: z.boolean() });

/** Accept an invitation as the signed-in person, with his choice about sharing progress. */
export async function POST(request: Request) {
  return asSignedIn(async (user) => {
    const parsed = await readJson(request, body);
    if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
    const { organization, asManager } = await acceptInvitation(getDb(), { token: parsed.data.token, user, share: parsed.data.share });
    return NextResponse.json({ slug: organization.slug, asManager });
  });
}
