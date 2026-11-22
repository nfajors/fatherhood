/**
 * Coach conversations: private to the member, who can delete them. Only the
 * text of each turn is kept (not the library lookups behind it).
 */
import { and, asc, count, desc, eq, gte } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { coachConversations, coachMessages } from "@/lib/db/schema";
import { COACH_POLICY } from "./policy";

export class CoachError extends Error {
  constructor(
    readonly reason: "not_found" | "limit_reached" | "invalid",
    message: string,
  ) {
    super(message);
  }
}

export type CoachTurn = { role: "user" | "assistant"; content: string };

/** A title from the first message: its first line, cut at a word near 60 characters. */
export function conversationTitle(firstMessage: string): string {
  const line = firstMessage.trim().split("\n")[0]!.replace(/\s+/g, " ");
  if (line.length <= 60) return line || "New conversation";
  const cut = line.slice(0, 60);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 40)).trimEnd()}…`;
}

export async function listConversations(db: Database, userId: string, limit = 50) {
  return db
    .select({ id: coachConversations.id, title: coachConversations.title, updatedAt: coachConversations.updatedAt })
    .from(coachConversations)
    .where(eq(coachConversations.userId, userId))
    .orderBy(desc(coachConversations.updatedAt))
    .limit(limit);
}

/** A conversation with its messages, only for its owner. */
export async function getConversation(db: Database, userId: string, conversationId: string) {
  const conversation = await db.query.coachConversations.findFirst({
    where: and(eq(coachConversations.id, conversationId), eq(coachConversations.userId, userId)),
  });
  if (!conversation) return null;
  const messages = await db
    .select({ id: coachMessages.id, role: coachMessages.role, content: coachMessages.content, createdAt: coachMessages.createdAt })
    .from(coachMessages)
    .where(eq(coachMessages.conversationId, conversationId))
    .orderBy(asc(coachMessages.createdAt), asc(coachMessages.role));
  return { ...conversation, messages };
}

export async function deleteConversation(db: Database, userId: string, conversationId: string): Promise<boolean> {
  const deleted = await db
    .delete(coachConversations)
    .where(and(eq(coachConversations.id, conversationId), eq(coachConversations.userId, userId)))
    .returning({ id: coachConversations.id });
  return deleted.length > 0;
}

/** Messages the member sent in the last 24 hours. */
export async function messagesToday(db: Database, userId: string, now: Date = new Date()): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(coachMessages)
    .where(and(eq(coachMessages.userId, userId), eq(coachMessages.role, "user"), gte(coachMessages.createdAt, new Date(now.getTime() - 24 * 3_600_000))));
  return row?.n ?? 0;
}

/**
 * Record what the member just wrote: in a new conversation, or appended to one of theirs.
 * Checks the length and the daily limit first. Returns the conversation and the
 * history to send the model (earlier turns, oldest first, ending with this message).
 */
export async function recordUserMessage(
  db: Database,
  input: { userId: string; conversationId: string | null; text: string; now?: Date },
): Promise<{ conversationId: string; history: CoachTurn[]; isNew: boolean }> {
  const text = input.text.trim();
  if (!text) throw new CoachError("invalid", "Write a message first.");
  if (text.length > COACH_POLICY.maxMessageChars) throw new CoachError("invalid", `Keep messages under ${COACH_POLICY.maxMessageChars.toLocaleString("en-US")} characters.`);
  const now = input.now ?? new Date();
  if ((await messagesToday(db, input.userId, now)) >= COACH_POLICY.dailyMessages) {
    throw new CoachError("limit_reached", `You've reached today's limit of ${COACH_POLICY.dailyMessages} messages with the coach. It resets over the next day.`);
  }

  return db.transaction(async (tx) => {
    let conversationId = input.conversationId;
    if (conversationId) {
      const [owned] = await tx
        .update(coachConversations)
        .set({ updatedAt: now })
        .where(and(eq(coachConversations.id, conversationId), eq(coachConversations.userId, input.userId)))
        .returning({ id: coachConversations.id });
      if (!owned) throw new CoachError("not_found", "Conversation not found.");
    } else {
      const [created] = await tx
        .insert(coachConversations)
        .values({ userId: input.userId, title: conversationTitle(text), createdAt: now, updatedAt: now })
        .returning({ id: coachConversations.id });
      conversationId = created!.id;
    }
    const earlier = await tx
      .select({ role: coachMessages.role, content: coachMessages.content })
      .from(coachMessages)
      .where(eq(coachMessages.conversationId, conversationId))
      .orderBy(desc(coachMessages.createdAt), desc(coachMessages.role))
      .limit(COACH_POLICY.historyMessages);
    await tx.insert(coachMessages).values({ conversationId, userId: input.userId, role: "user", content: text, createdAt: now });
    return { conversationId, history: [...trimHistory(earlier.reverse()), { role: "user" as const, content: text }], isNew: !input.conversationId };
  });
}

/**
 * Earlier turns as the API needs them: starting with a user turn and alternating.
 * A user message whose reply failed is followed by another user message; the two
 * are merged so the model sees what was asked.
 */
export function trimHistory(turns: CoachTurn[]): CoachTurn[] {
  const out: CoachTurn[] = [];
  for (const turn of turns) {
    if (out.length === 0 && turn.role === "assistant") continue;
    const last = out.at(-1);
    if (last && last.role === turn.role) last.content = `${last.content}\n\n${turn.content}`;
    else out.push({ ...turn });
  }
  // The new user message follows, so the history must end with the coach's reply.
  while (out.at(-1)?.role === "user") out.pop();
  return out;
}

export async function recordAssistantMessage(
  db: Database,
  input: { userId: string; conversationId: string; text: string; model: string; inputTokens: number; outputTokens: number; stopReason: string | null; now?: Date },
) {
  const now = input.now ?? new Date();
  const [row] = await db
    .insert(coachMessages)
    .values({
      conversationId: input.conversationId,
      userId: input.userId,
      role: "assistant",
      content: input.text,
      model: input.model,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      stopReason: input.stopReason,
      createdAt: now,
    })
    .returning({ id: coachMessages.id });
  await db.update(coachConversations).set({ updatedAt: now }).where(eq(coachConversations.id, input.conversationId));
  return row!.id;
}
