/**
 * The coach on Claude: streaming replies, with two library tools run by the SDK's
 * tool runner. Text written before a lookup ("Let me find that lesson") and the
 * answer after it stream as one reply.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { coachConfigured } from "./access";
import type { CoachTurn } from "./conversations";
import type { CoachModel, CoachTools, ModelEvent } from "./engine";
import { COACH_POLICY } from "./policy";
import { COACH_INSTRUCTIONS } from "./prompt";

const SearchInput = z.object({
  query: z.string().min(2).max(200).describe("A few keywords for the topic, e.g. 'toddler tantrums discipline' or 'divorce co-parenting holidays'"),
});
const ReadInput = z.object({
  kind: z.enum(["lesson", "community", "course"]),
  id: z.string().uuid().describe("The id from search_library or a course's lesson list"),
});

/** A status line for the page while a lookup runs. */
export function describeLookup(name: string, input: unknown): string {
  if (name === "search_library") {
    const query = SearchInput.safeParse(input);
    return query.success ? `Looking through the library for “${query.data.query}”` : "Looking through the library";
  }
  return "Reading a lesson";
}

function buildTools(tools: CoachTools) {
  // eager_input_streaming streams tool input as it's written (SDK 0.135 takes it spread onto the tool).
  return [
    {
      ...betaZodTool({
        name: "search_library",
        description:
          "Search the academy's lessons, courses and Community Voices stories (videos by other fathers) by topic. Returns titles, links, lengths and short excerpts. Search before recommending anything, and search again with different words if the first results don't fit.",
        inputSchema: SearchInput,
        run: async ({ query }) => {
          const hits = await tools.search(query);
          return hits.length ? JSON.stringify(hits) : "No matches. Try different or broader words.";
        },
      }),
      eager_input_streaming: true,
    },
    {
      ...betaZodTool({
        name: "read_item",
        description:
          "Read one lesson or Community Voices story in full (summary and transcript), or a course's outline, before relying on what it says. Use the kind and id from search_library.",
        inputSchema: ReadInput,
        run: async ({ kind, id }) => {
          const item = await tools.read(kind, id);
          return item ? JSON.stringify(item) : "Not found, or not published.";
        },
      }),
      eager_input_streaming: true,
    },
  ];
}

export class ClaudeCoach implements CoachModel {
  constructor(private readonly client: Anthropic = new Anthropic()) {}

  async *reply({ context, history, tools, signal }: { context: string; history: CoachTurn[]; tools: CoachTools; signal?: AbortSignal }): AsyncGenerator<ModelEvent> {
    const runner = this.client.beta.messages.toolRunner(
      {
        model: COACH_POLICY.model,
        max_tokens: COACH_POLICY.maxOutputTokens,
        max_iterations: COACH_POLICY.maxToolIterations,
        output_config: { effort: COACH_POLICY.effort },
        // Retry on Anthropic's recommended model if a safety classifier declines.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        // The instructions are the same for everyone, so they're cached; the member's context follows them.
        system: [
          { type: "text", text: COACH_INSTRUCTIONS, cache_control: { type: "ephemeral" } },
          { type: "text", text: context },
        ],
        // Caches the conversation so far, for the lookups within this turn and the next turn.
        cache_control: { type: "ephemeral" },
        messages: history.map((t) => ({ role: t.role, content: t.content })),
        tools: buildTools(tools),
        stream: true,
      },
      { signal },
    );

    let model: string = COACH_POLICY.model;
    let stopReason: string | null = null;
    let inputTokens = 0;
    let outputTokens = 0;
    let wroteText = false;

    for await (const messageStream of runner) {
      let startedThisTurn = false;
      for await (const event of messageStream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          // Separate text written before a lookup from the answer after it.
          const prefix = wroteText && !startedThisTurn ? "\n\n" : "";
          startedThisTurn = true;
          wroteText = true;
          yield { type: "text", text: prefix + event.delta.text };
        }
      }
      const message = await messageStream.finalMessage();
      model = message.model;
      stopReason = message.stop_reason;
      inputTokens += message.usage.input_tokens + (message.usage.cache_read_input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0);
      outputTokens += message.usage.output_tokens;

      const toolUses = message.content.filter((b) => b.type === "tool_use");
      // A refusal can cut a tool call off mid-input, and a call cut off at max_tokens can still look valid: never run either.
      if (message.stop_reason === "refusal" || (message.stop_reason === "max_tokens" && toolUses.length)) break;
      for (const block of toolUses) yield { type: "lookup", description: describeLookup(block.name, block.input) };
    }

    yield { type: "finished", model, stopReason, inputTokens, outputTokens };
  }
}

let coach: CoachModel | undefined;

/** The production coach, or null when no Anthropic credentials are configured. */
export function getCoach(): CoachModel | null {
  if (!coachConfigured()) return null;
  coach ??= new ClaudeCoach();
  return coach;
}
