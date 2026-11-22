/**
 * One coach turn: record the member's message, have the model answer (with
 * library lookups), stream the answer as it's written, and record it.
 */
import type { Database } from "@/lib/db";
import { fatherContext, renderContext } from "./context";
import { recordAssistantMessage, recordUserMessage, type CoachTurn } from "./conversations";
import { readLibraryItem, searchLibrary, type LibraryHit, type LibraryKind } from "./library";

/** What the coach can look up. Production uses the library; tests can pass their own. */
export type CoachTools = {
  search(query: string): Promise<LibraryHit[]>;
  read(kind: LibraryKind, id: string): Promise<unknown | null>;
};

export const libraryTools = (db: Database): CoachTools => ({
  search: (query) => searchLibrary(db, query),
  read: (kind, id) => readLibraryItem(db, kind, id),
});

export type ModelEvent =
  | { type: "text"; text: string }
  | { type: "lookup"; description: string }
  | { type: "finished"; model: string; stopReason: string | null; inputTokens: number; outputTokens: number };

/** The model behind the coach (Claude in production, a fake in tests). */
export interface CoachModel {
  reply(input: { context: string; history: CoachTurn[]; tools: CoachTools; signal?: AbortSignal }): AsyncIterable<ModelEvent>;
}

/** What the page receives, one JSON object per line. */
export type CoachEvent =
  | { type: "conversation"; id: string; isNew: boolean }
  | { type: "status"; text: string }
  | { type: "text"; text: string }
  | { type: "done"; messageId: string }
  | { type: "error"; message: string };

export const REFUSAL_TEXT =
  "I'm not able to help with that one. If you or anyone else might be in danger, please call 911, or call or text 988 to reach the Suicide & Crisis Lifeline. I'm glad to keep talking about anything else on your mind.";

/**
 * Records the message (throwing CoachError for a bad message, a conversation that
 * isn't his, or the daily limit), then returns the stream of events for the answer.
 */
export async function startCoachTurn(
  db: Database,
  model: CoachModel,
  input: { userId: string; conversationId: string | null; text: string; tools?: CoachTools; signal?: AbortSignal; now?: Date },
): Promise<AsyncGenerator<CoachEvent>> {
  const { conversationId, history, isNew } = await recordUserMessage(db, input);
  const context = renderContext(await fatherContext(db, input.userId), input.now);
  const tools = input.tools ?? libraryTools(db);

  return (async function* () {
    yield { type: "conversation", id: conversationId, isNew };
    let text = "";
    let finished: Extract<ModelEvent, { type: "finished" }> | null = null;
    try {
      for await (const event of model.reply({ context, history, tools, signal: input.signal })) {
        if (event.type === "text") {
          text += event.text;
          yield { type: "text", text: event.text };
        } else if (event.type === "lookup") {
          yield { type: "status", text: event.description };
        } else {
          finished = event;
        }
      }
    } catch (error) {
      console.error(`Coach reply failed (conversation ${conversationId})`, error);
      yield { type: "error", message: "The coach couldn't finish that reply. Please try again in a moment." };
      return;
    }

    if (finished?.stopReason === "refusal") {
      const replacement = text ? `\n\n${REFUSAL_TEXT}` : REFUSAL_TEXT;
      text += replacement;
      yield { type: "text", text: replacement };
    }
    if (!text.trim()) {
      yield { type: "error", message: "The coach didn't have an answer that time. Please try asking another way." };
      return;
    }
    const messageId = await recordAssistantMessage(db, {
      userId: input.userId,
      conversationId,
      text: text.trim(),
      model: finished?.model ?? "unknown",
      inputTokens: finished?.inputTokens ?? 0,
      outputTokens: finished?.outputTokens ?? 0,
      stopReason: finished?.stopReason ?? null,
      now: input.now,
    });
    yield { type: "done", messageId };
  })();
}
