import { after, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { sendReplyNotice } from "@/lib/discussions/runtime";
import { getPostScreener } from "@/lib/discussions/screen";
import { createPost } from "@/lib/discussions/service";
import { asSignedIn, invalid, json } from "../_shared";

const body = z.object({ body: z.string().max(10_000), groupId: z.uuid().nullable().optional(), parentId: z.uuid().nullable().optional() });

/** Post or reply. The AI check runs first: the answer says whether it's up or waiting for a moderator. */
export async function POST(request: Request) {
  return asSignedIn(async (user) => {
    const parsed = await json(request, body);
    if (!parsed.success) return invalid();
    const result = await createPost(getDb(), getPostScreener(), user, parsed.data);
    if (result.status === "visible" && result.parentId) after(() => sendReplyNotice(result.id));
    return NextResponse.json({ id: result.id, status: result.status, atRisk: result.atRisk, threadId: result.parentId ?? result.id });
  });
}
