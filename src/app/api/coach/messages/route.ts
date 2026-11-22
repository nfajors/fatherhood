import { z } from "zod";
import { getCoach } from "@/lib/coach/claude";
import { startCoachTurn, type CoachEvent } from "@/lib/coach/engine";
import { getDb } from "@/lib/db";
import { readJson } from "../../admin/_shared";
import { asCoachMember } from "../_shared";

export const dynamic = "force-dynamic";

const body = z.object({ conversationId: z.uuid().nullable().optional(), text: z.string() });

/**
 * Send the coach a message. The reply streams back as newline-delimited JSON
 * events (see CoachEvent): the conversation id, status lines while the coach
 * looks things up, text as it's written, then done or error.
 */
export async function POST(request: Request) {
  return asCoachMember(async (member) => {
    const parsed = await readJson(request, body);
    if (!parsed.success) return Response.json({ error: "invalid", message: "Write a message first." }, { status: 400 });
    const coach = getCoach()!;
    const events = await startCoachTurn(getDb(), coach, {
      userId: member.id,
      conversationId: parsed.data.conversationId ?? null,
      text: parsed.data.text,
      signal: request.signal,
    });
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const next = await events.next();
        if (next.done) controller.close();
        else controller.enqueue(encoder.encode(`${JSON.stringify(next.value satisfies CoachEvent)}\n`));
      },
      async cancel() {
        await events.return(undefined);
      },
    });
    return new Response(stream, {
      headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
    });
  });
}
