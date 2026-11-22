import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { DiscussionError, setGroupModerator } from "@/lib/discussions/service";
import { asAdmin, readJson } from "../../../../_shared";

const body = z.object({ email: z.email(), moderator: z.boolean() });

/** Make an account a moderator of the group (or back to a member). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return asAdmin(async () => {
    const id = z.uuid().safeParse((await params).id);
    const parsed = await readJson(request, body);
    if (!id.success || !parsed.success) return NextResponse.json({ error: "invalid", message: "Enter an email address." }, { status: 400 });
    try {
      await setGroupModerator(getDb(), { groupId: id.data, ...parsed.data });
      return NextResponse.json({ saved: true });
    } catch (error) {
      if (error instanceof DiscussionError) return NextResponse.json({ error: error.reason, message: error.message }, { status: 404 });
      throw error;
    }
  });
}
