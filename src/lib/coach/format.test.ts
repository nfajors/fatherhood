import { describe, expect, it } from "vitest";
import { parseInline, parseReply, safeHref } from "./format";

describe("safeHref", () => {
  it("keeps paths on this site only", () => {
    expect(safeHref("/academy/presence/123")).toBe("/academy/presence/123");
    expect(safeHref("/search?q=bedtime#top")).toBe("/search?q=bedtime#top");
    expect(safeHref("//evil.example")).toBeNull();
    expect(safeHref("/\\evil.example")).toBeNull();
    expect(safeHref("https://example.com")).toBeNull();
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref('/a"onmouseover=x')).toBeNull();
  });
});

describe("parseInline", () => {
  it("reads bold, italics and links", () => {
    expect(parseInline("Try **one thing**: watch [The ten-minute rule](/academy/presence/1), *tonight*.")).toEqual([
      { kind: "text", text: "Try " },
      { kind: "bold", text: "one thing" },
      { kind: "text", text: ": watch " },
      { kind: "link", text: "The ten-minute rule", href: "/academy/presence/1" },
      { kind: "text", text: ", " },
      { kind: "italic", text: "tonight" },
      { kind: "text", text: "." },
    ]);
  });

  it("shows an outside link as plain text", () => {
    expect(parseInline("See [this](https://example.com) now")).toEqual([{ kind: "text", text: "See this now" }]);
  });

  it("leaves arithmetic and lone asterisks alone", () => {
    expect(parseInline("2 * 3 * 4")).toEqual([{ kind: "text", text: "2 * 3 * 4" }]);
  });
});

describe("parseReply", () => {
  it("splits paragraphs and lists, and turns headings into bold lines", () => {
    const text = "That sounds hard.\nYou're not alone.\n\n## This week\n- Put the phone away at dinner\n- Ask one question\n\n1. First\n2. Second";
    expect(parseReply(text)).toEqual([
      { kind: "p", content: [{ kind: "text", text: "That sounds hard. You're not alone." }] },
      { kind: "p", content: [{ kind: "bold", text: "This week" }] },
      { kind: "ul", items: [[{ kind: "text", text: "Put the phone away at dinner" }], [{ kind: "text", text: "Ask one question" }]] },
      { kind: "ol", items: [[{ kind: "text", text: "First" }], [{ kind: "text", text: "Second" }]] },
    ]);
  });
});
