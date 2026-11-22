/** Send the coach a message and read his reply as it's written (the website's streaming endpoint). */
import { fetch } from "expo/fetch";
import { ApiError, authHeaders } from "../api/client";
import { API_URL } from "../config";
import { LineSplitter, parseCoachEvent, type CoachEvent } from "./ndjson";

export async function* sendToCoach(input: { conversationId: string | null; text: string; signal?: AbortSignal }): AsyncGenerator<CoachEvent> {
  let res;
  try {
    res = await fetch(`${API_URL}/api/coach/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/x-ndjson", ...authHeaders() },
      body: JSON.stringify({ conversationId: input.conversationId, text: input.text }),
      signal: input.signal,
    });
  } catch {
    throw new ApiError(0, "offline", "You're offline. The coach needs a connection.");
  }
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
    throw new ApiError(res.status, data?.error ?? "error", data?.message ?? "The coach couldn't answer just now. Please try again.");
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const lines = new LineSplitter();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      const chunk = done ? lines.flush() : lines.push(decoder.decode(value, { stream: true }));
      for (const line of chunk) {
        const event = parseCoachEvent(line);
        if (event) yield event;
      }
      if (done) return;
    }
  } finally {
    reader.releaseLock();
  }
}
