import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { joinWithCode } from "@/lib/organizations/service";
import { readJson } from "../../admin/_shared";
import { asSignedIn } from "../../org/_shared";

const body = z.object({ code: z.string().min(4).max(40), share: z.boolean() });

/** Join an organization with its shared code. */
export async function POST(request: Request) {
  return asSignedIn(async (user) => {
    const parsed = await readJson(request, body);
    if (!parsed.success) return NextResponse.json({ error: "invalid", message: "Enter the code you were given." }, { status: 400 });
    const org = await joinWithCode(getDb(), { code: parsed.data.code, user, share: parsed.data.share });
    return NextResponse.json({ name: org.name });
  });
}
