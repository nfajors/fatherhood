import { after, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { sendReplyNotice } from "@/lib/discussions/runtime";
import { moderatePost } from "@/lib/discussions/service";
import { asSignedIn, invalid, json, uuid } from "../../../_shared";

const body = z.object({ action: z.enum(["approve", "hide", "restore", "remove"]) });

/** Admins, or the group's moderators: approve a held post, hide, restore or remove one. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = uuid.safeParse((await params).id);
  return asSignedIn(async (user) => {
    const parsed = await json(request, body);
    if (!id.success || !parsed.success) return invalid();
    const result = await moderatePost(getDb(), user, id.data, parsed.data.action);
    if (result.replyBecameVisible) after(() => sendReplyNotice(id.data));
    return NextResponse.json(result);
  });
}
