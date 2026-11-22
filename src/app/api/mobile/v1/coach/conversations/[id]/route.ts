import { z } from "zod";
import { getConversation } from "@/lib/coach/conversations";
import { asAppUser, json } from "../../../_shared";

export const dynamic = "force-dynamic";

/** One of his conversations with the coach. (Deleting uses /api/coach/conversations/[id].) */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return json({ error: "not_found" }, 404);
  return asAppUser(async ({ db, user }) => {
    const conversation = await getConversation(db, user.id, id.data);
    if (!conversation) return json({ error: "not_found" }, 404);
    return json({
      id: conversation.id,
      title: conversation.title,
      messages: conversation.messages.map((m) => ({ id: m.id, role: m.role, content: m.content, createdAt: m.createdAt.toISOString() })),
    });
  });
}
