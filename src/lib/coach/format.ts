/**
 * The coach's replies use a little Markdown: paragraphs, bulleted and numbered
 * lists, **bold**, *italics* and [links](/path). This turns it into a plain
 * structure the page renders as React elements, never as HTML. Links are kept
 * only to paths on this site; anything else shows as its text.
 */
export type Inline = { kind: "text" | "bold" | "italic"; text: string } | { kind: "link"; text: string; href: string };
export type Block = { kind: "p"; content: Inline[] } | { kind: "ul" | "ol"; items: Inline[][] };

/** Same-site paths only: "/academy/x", not "//evil.com", "javascript:" or "https://". */
export function safeHref(href: string): string | null {
  const h = href.trim();
  return /^\/(?![/\\])[A-Za-z0-9\-._~/?#=&%]*$/.test(h) ? h : null;
}

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const pattern = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)|(?<![*\w])\*(?!\s)(.+?)(?<!\s)\*(?![*\w])/g;
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    if (m.index! > last) out.push({ kind: "text", text: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ kind: "bold", text: m[1] });
    else if (m[2] !== undefined) {
      const href = safeHref(m[3]!);
      out.push(href ? { kind: "link", text: m[2], href } : { kind: "text", text: m[2] });
    } else out.push({ kind: "italic", text: m[4]! });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  // Merge neighbouring text pieces.
  return out.reduce<Inline[]>((acc, piece) => {
    const prev = acc.at(-1);
    if (prev && prev.kind === "text" && piece.kind === "text") prev.text += piece.text;
    else acc.push({ ...piece });
    return acc;
  }, []);
}

export function parseReply(text: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "p", content: parseInline(paragraph.join(" ")) });
    paragraph = [];
  };
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (!line) {
      flush();
    } else if (bullet || numbered) {
      flush();
      const kind = bullet ? "ul" : "ol";
      const item = parseInline((bullet ?? numbered)![1]!);
      const prev = blocks.at(-1);
      if (prev && prev.kind === kind) prev.items.push(item);
      else blocks.push({ kind, items: [item] });
    } else {
      // Headings become bold lines of their own.
      const heading = /^#{1,6}\s+(.*)$/.exec(line);
      if (heading) {
        flush();
        blocks.push({ kind: "p", content: [{ kind: "bold", text: heading[1]! }] });
      } else paragraph.push(line);
    }
  }
  flush();
  return blocks;
}
