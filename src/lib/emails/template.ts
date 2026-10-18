/**
 * Email layout for sequences and notifications. Content is described as
 * blocks so every email gets matching HTML and plain-text versions, escaped
 * text, absolute links with campaign tags, and the unsubscribe footer.
 */
import { SITE } from "@/lib/config";
import type { EmailCategory } from "@/lib/db/schema";
import type { EmailMessage } from "@/lib/email";
import { CATEGORY_LABELS } from "./policy";

export type EmailItem = { title: string; href: string; meta?: string | null; note?: string | null };

export type EmailBlock =
  | { kind: "p"; text: string }
  | { kind: "button"; label: string; href: string }
  | { kind: "items"; items: EmailItem[] }
  | { kind: "quote"; text: string; cite?: string }
  | { kind: "small"; text: string };

export type EmailContent = {
  subject: string;
  /** The inbox preview line. */
  preheader?: string;
  heading: string;
  blocks: EmailBlock[];
};

export type Delivery = {
  appUrl: string;
  to: string;
  category: EmailCategory;
  /** Signed settings token for the recipient. */
  token: string;
  /** Tags links for analytics, e.g. "welcome-start". */
  campaign: string;
  postalAddress?: string | null;
  idempotencyKey?: string;
};

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Site links become absolute and tagged; anything else is left alone. */
export function siteLink(href: string, appUrl: string, campaign: string): string {
  if (/^https?:\/\//.test(href) && !href.startsWith(appUrl)) return href;
  const url = new URL(href, appUrl);
  url.searchParams.set("utm_source", "email");
  url.searchParams.set("utm_medium", "email");
  url.searchParams.set("utm_campaign", campaign);
  return url.toString();
}

export function settingsUrls(appUrl: string, token: string, category: EmailCategory) {
  const t = encodeURIComponent(token);
  return {
    /** The page a person clicks through to (confirms, then shows all settings). */
    unsubscribePage: `${appUrl}/email/unsubscribe?t=${t}&c=${category}`,
    /** RFC 8058 one-click endpoint for mail clients. */
    oneClick: `${appUrl}/api/email/unsubscribe?t=${t}&c=${category}`,
    settings: `${appUrl}/email/unsubscribe?t=${t}`,
  };
}

const P = "font-size:16px;line-height:1.55;margin:0 0 16px";

function blockHtml(block: EmailBlock, link: (href: string) => string): string {
  switch (block.kind) {
    case "p":
      return `<p style="${P}">${escapeHtml(block.text)}</p>`;
    case "small":
      return `<p style="font-size:14px;line-height:1.5;color:#5b6475;margin:0 0 16px">${escapeHtml(block.text)}</p>`;
    case "button":
      return `<p style="margin:24px 0"><a href="${escapeHtml(link(block.href))}" style="display:inline-block;padding:12px 24px;border-radius:8px;background:#c48b2c;color:#070f1f;font-weight:bold;text-decoration:none">${escapeHtml(block.label)}</a></p>`;
    case "quote":
      return `<blockquote style="margin:0 0 16px;padding:12px 16px;border-left:3px solid #c48b2c;background:#fff;font-size:15px;line-height:1.5">${escapeHtml(block.text).replace(/\n/g, "<br>")}${
        block.cite ? `<br><span style="font-size:13px;color:#5b6475">${escapeHtml(block.cite)}</span>` : ""
      }</blockquote>`;
    case "items":
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;border-collapse:separate;border-spacing:0 8px">${block.items
        .map(
          (item) => `<tr><td style="padding:14px 16px;border:1px solid #e3e1da;border-radius:10px;background:#fff">
<a href="${escapeHtml(link(item.href))}" style="font-size:16px;font-weight:bold;color:#0c1a33;text-decoration:none">${escapeHtml(item.title)}</a>${
            item.meta ? `<br><span style="font-size:13px;color:#5b6475">${escapeHtml(item.meta)}</span>` : ""
          }${item.note ? `<br><span style="font-size:14px;color:#121826">${escapeHtml(item.note)}</span>` : ""}</td></tr>`,
        )
        .join("")}</table>`;
  }
}

function blockText(block: EmailBlock, link: (href: string) => string): string {
  switch (block.kind) {
    case "p":
    case "small":
      return block.text;
    case "button":
      return `${block.label}: ${link(block.href)}`;
    case "quote":
      return `> ${block.text.replace(/\n/g, "\n> ")}${block.cite ? `\n${block.cite}` : ""}`;
    case "items":
      return block.items.map((i) => `- ${i.title}${i.meta ? ` (${i.meta})` : ""}${i.note ? `\n  ${i.note}` : ""}\n  ${link(i.href)}`).join("\n");
  }
}

/** Turn content into a ready-to-send message with the unsubscribe footer and headers. */
export function renderEmail(content: EmailContent, delivery: Delivery): EmailMessage {
  const link = (href: string) => siteLink(href, delivery.appUrl, delivery.campaign);
  const urls = settingsUrls(delivery.appUrl, delivery.token, delivery.category);
  const why = `You're getting this because you have a ${SITE.name} account and "${CATEGORY_LABELS[delivery.category].label}" is on in your email settings.`;
  const address = delivery.postalAddress?.trim();

  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(content.subject)}</title></head>
<body style="margin:0;background:#fbfaf7;font-family:Helvetica,Arial,sans-serif;color:#121826">
${content.preheader ? `<div style="display:none;max-height:0;overflow:hidden">${escapeHtml(content.preheader)}</div>` : ""}
<div style="max-width:560px;margin:0 auto;padding:32px 24px">
<p style="font-family:Georgia,serif;font-size:20px;font-weight:bold;color:#0c1a33;margin:0 0 24px">Fatherhood<span style="color:#c48b2c">.School</span></p>
<h1 style="font-family:Georgia,serif;font-size:26px;line-height:1.25;color:#0c1a33;margin:0 0 16px">${escapeHtml(content.heading)}</h1>
${content.blocks.map((b) => blockHtml(b, link)).join("\n")}
<hr style="border:none;border-top:1px solid #e3e1da;margin:32px 0 16px">
<p style="font-size:12px;line-height:1.5;color:#5b6475;margin:0">${escapeHtml(why)}<br>
<a href="${escapeHtml(urls.unsubscribePage)}" style="color:#5b6475">Unsubscribe from these emails</a> · <a href="${escapeHtml(urls.settings)}" style="color:#5b6475">Email settings</a></p>
<p style="font-size:12px;color:#5b6475;margin:8px 0 0">${SITE.name} · Companion academy to <em>${escapeHtml(SITE.bookTitle)}</em>${address ? `<br>${escapeHtml(address)}` : ""}</p>
</div></body></html>`;

  const text = [
    content.heading,
    "",
    ...content.blocks.flatMap((b) => [blockText(b, link), ""]),
    "--",
    why,
    `Unsubscribe: ${urls.unsubscribePage}`,
    `Email settings: ${urls.settings}`,
    `${SITE.name}${address ? ` · ${address}` : ""}`,
  ].join("\n");

  return {
    to: delivery.to,
    subject: content.subject,
    html,
    text,
    idempotencyKey: delivery.idempotencyKey,
    headers: { "List-Unsubscribe": `<${urls.oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  };
}
