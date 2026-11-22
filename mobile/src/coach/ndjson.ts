/** The coach's reply arrives as newline-delimited JSON events (see the server's CoachEvent). */
export type CoachEvent =
  | { type: "conversation"; id: string; isNew: boolean }
  | { type: "status"; text: string }
  | { type: "text"; text: string }
  | { type: "done"; messageId: string }
  | { type: "error"; message: string };

/** Turns arbitrary text chunks into whole lines. */
export class LineSplitter {
  private buffer = "";

  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    return lines.filter((l) => l.trim());
  }

  flush(): string[] {
    const rest = this.buffer.trim();
    this.buffer = "";
    return rest ? [rest] : [];
  }
}

const TYPES = new Set(["conversation", "status", "text", "done", "error"]);

export function parseCoachEvent(line: string): CoachEvent | null {
  try {
    const value = JSON.parse(line) as { type?: unknown };
    return value && typeof value.type === "string" && TYPES.has(value.type) ? (value as CoachEvent) : null;
  } catch {
    return null;
  }
}
