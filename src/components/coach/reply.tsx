import Link from "next/link";
import { Fragment } from "react";
import { parseReply, type Inline } from "@/lib/coach/format";

function InlineText({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((p, i) => {
        if (p.kind === "bold") return <strong key={i}>{p.text}</strong>;
        if (p.kind === "italic") return <em key={i}>{p.text}</em>;
        if (p.kind === "link")
          return (
            <Link key={i} href={p.href} className="font-medium text-navy-900 underline decoration-gold-500 decoration-2 underline-offset-2 hover:decoration-navy-900">
              {p.text}
            </Link>
          );
        return <Fragment key={i}>{p.text}</Fragment>;
      })}
    </>
  );
}

/** A coach reply: paragraphs, lists, emphasis and links to pages on this site. Rendered as elements, never as HTML. */
export function CoachReply({ text }: { text: string }) {
  return (
    <div className="space-y-3 leading-relaxed">
      {parseReply(text).map((block, i) => {
        if (block.kind === "p")
          return (
            <p key={i}>
              <InlineText parts={block.content} />
            </p>
          );
        const List = block.kind === "ul" ? "ul" : "ol";
        return (
          <List key={i} className={`space-y-1 pl-5 ${block.kind === "ul" ? "list-disc" : "list-decimal"}`}>
            {block.items.map((item, j) => (
              <li key={j}>
                <InlineText parts={item} />
              </li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
