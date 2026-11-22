"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import type { CoachEvent } from "@/lib/coach/engine";
import { COACH_POLICY } from "@/lib/coach/policy";
import { CoachReply } from "./reply";

export type ChatMessage = { id: string; role: "user" | "assistant"; content: string };

const STARTERS = [
  "My toddler fights bedtime every night. Where do I start?",
  "How do I stay close to my kids when I travel for work?",
  "My teenager barely talks to me anymore. What can I do?",
  "We're expecting our first. How do I get ready as a dad?",
];

async function* readEvents(response: Response): AsyncGenerator<CoachEvent> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) yield JSON.parse(line) as CoachEvent;
    }
    if (done) return;
  }
}

/**
 * The conversation with the coach. Replies stream in as they're written; a status
 * line shows while the coach looks something up. A new conversation gets its
 * own address once the first reply starts.
 */
export function CoachChat({ conversationId: initialId, initialMessages, firstName }: { conversationId: string | null; initialMessages: ChatMessage[]; firstName: string }) {
  const router = useRouter();
  const [conversationId, setConversationId] = useState(initialId);
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const busy = streaming !== null;

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages.length, streaming, status]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setError(null);
    setDraft("");
    setMessages((m) => [...m, { id: `local-${Date.now()}`, role: "user", content: message }]);
    setStreaming("");
    setStatus(null);
    setAnnounce("");
    const controller = new AbortController();
    abort.current = controller;
    let reply = "";
    try {
      const res = await fetch("/api/coach/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, text: message }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(data.message ?? "The coach couldn't answer just now. Please try again.");
      }
      for await (const event of readEvents(res)) {
        if (event.type === "conversation") {
          setConversationId(event.id);
          if (event.isNew) window.history.replaceState(null, "", `/coach/${event.id}`);
        } else if (event.type === "status") {
          setStatus(event.text);
        } else if (event.type === "text") {
          reply += event.text;
          setStatus(null);
          setStreaming(reply);
        } else if (event.type === "done") {
          setMessages((m) => [...m, { id: event.messageId, role: "assistant", content: reply.trim() }]);
          setAnnounce("The coach replied.");
          router.refresh();
        } else if (event.type === "error") {
          throw new Error(event.message);
        }
      }
    } catch (err) {
      if (controller.signal.aborted) setError("Stopped. That reply wasn't saved; ask again whenever you like.");
      else setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setStreaming(null);
      setStatus(null);
      abort.current = null;
      input.current?.focus();
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void send(draft);
  }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send(draft);
    }
  }

  const left = COACH_POLICY.maxMessageChars - draft.length;

  return (
    <div className="flex min-h-[60vh] flex-col">
      <div className="flex-1 space-y-6 pb-6">
        {messages.length === 0 && !busy && (
          <div className="rounded-xl border border-navy-900/10 bg-white p-6">
            <p className="font-serif text-2xl font-semibold text-navy-900">What&apos;s on your mind, {firstName}?</p>
            <p className="mt-2 text-muted">
              Talk through something happening at home, or ask what to watch next. The coach knows the academy&apos;s lessons and stories, and what
              you&apos;ve been working on.
            </p>
            <ul className="mt-5 grid gap-2 sm:grid-cols-2">
              {STARTERS.map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    onClick={() => void send(s)}
                    className="h-full w-full rounded-lg border border-navy-900/15 px-4 py-3 text-left text-sm hover:border-gold-500 hover:bg-gold-100/40"
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {messages.map((m) => (
          <Message key={m.id} role={m.role} content={m.content} />
        ))}
        {busy && (
          <div>
            {streaming ? <Message role="assistant" content={streaming} /> : null}
            <p className="mt-2 flex items-center gap-2 text-sm text-muted" aria-live="polite">
              <span className="inline-block size-2 animate-pulse rounded-full bg-gold-500" aria-hidden />
              {status ?? (streaming ? "Writing…" : "Thinking…")}
            </p>
          </div>
        )}
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </p>
        )}
        <p className="sr-only" aria-live="polite">
          {announce}
        </p>
        <div ref={end} />
      </div>

      <form onSubmit={submit} className="sticky bottom-0 -mx-4 border-t border-navy-900/10 bg-paper px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:mx-0 sm:px-0">
        <label htmlFor="coach-message" className="sr-only">
          Message the coach
        </label>
        <div className="flex items-end gap-2">
          <textarea
            id="coach-message"
            ref={input}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={keyDown}
            rows={2}
            maxLength={COACH_POLICY.maxMessageChars}
            placeholder="Ask the coach…"
            disabled={busy}
            className="max-h-48 min-h-12 flex-1 resize-y rounded-lg border border-navy-900/20 bg-white px-3 py-2 text-base"
          />
          {busy ? (
            <Button type="button" variant="outline" onClick={() => abort.current?.abort()}>
              Stop
            </Button>
          ) : (
            <Button type="submit" disabled={!draft.trim()}>
              Send
            </Button>
          )}
        </div>
        <p className="mt-1 flex justify-between text-xs text-muted">
          <span>Enter to send, Shift+Enter for a new line</span>
          {left < 200 && <span>{left} characters left</span>}
        </p>
      </form>
    </div>
  );
}

function Message({ role, content }: { role: "user" | "assistant"; content: string }) {
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-navy-900 px-4 py-3 text-white">
          <span className="sr-only">You: </span>
          {content}
        </div>
      </div>
    );
  }
  return (
    <div className="max-w-[95%]">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gold-600">Coach</p>
      <CoachReply text={content} />
    </div>
  );
}
