import { z } from "zod";
import { communityVideoView } from "@/lib/mobile/api";
import { asAppUser, json } from "../../_shared";

export const dynamic = "force-dynamic";

/** A Community Voices story: its details and his place in it. (Lessons come with their course.) */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return json({ error: "not_found" }, 404);
  return asAppUser(async ({ db, user }) => {
    const view = await communityVideoView(db, id.data, user.id);
    return view ? json(view) : json({ error: "not_found" }, 404);
  });
}
