import { describe, expect, it } from "vitest";
import { LineSplitter, parseCoachEvent } from "./ndjson";

describe("coach stream", () => {
  it("reassembles lines split across chunks", () => {
    const s = new LineSplitter();
    expect(s.push('{"type":"conversation","id":"c1","isNew":true}\n{"type":"te')).toEqual(['{"type":"conversation","id":"c1","isNew":true}']);
    expect(s.push('xt","text":"Hi"}\n\n')).toEqual(['{"type":"text","text":"Hi"}']);
    expect(s.push('{"type":"done","messageId":"m"}')).toEqual([]);
    expect(s.flush()).toEqual(['{"type":"done","messageId":"m"}']);
    expect(s.flush()).toEqual([]);
  });

  it("ignores lines that aren't coach events", () => {
    expect(parseCoachEvent('{"type":"text","text":"a\\nb"}')).toEqual({ type: "text", text: "a\nb" });
    expect(parseCoachEvent('{"type":"other"}')).toBeNull();
    expect(parseCoachEvent("not json")).toBeNull();
  });
});
