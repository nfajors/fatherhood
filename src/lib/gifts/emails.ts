/** Gift emails. Pure functions: every user-supplied value is escaped. */
import { GIFT_TERMS, SITE, type PlanId } from "@/lib/config";
import type { EmailMessage } from "@/lib/email";

export type GiftForEmail = {
  code: string;
  plan: PlanId;
  purchaserName: string;
  purchaserEmail: string;
  recipientName: string;
  recipientEmail: string | null;
  message: string | null;
  delivery: "email" | "self";
  deliverAt: Date | null;
};

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const formatDate = (date: Date) => date.toLocaleDateString("en-US", { dateStyle: "long", timeZone: "UTC" });

export function redeemUrl(appUrl: string, code: string): string {
  return `${appUrl}/redeem?code=${encodeURIComponent(code)}`;
}

function layout(bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#fbfaf7;font-family:Helvetica,Arial,sans-serif;color:#121826">
<div style="max-width:560px;margin:0 auto;padding:32px 24px">
<p style="font-family:Georgia,serif;font-size:20px;font-weight:bold;color:#0c1a33;margin:0 0 24px">Fatherhood<span style="color:#c48b2c">.School</span></p>
${bodyHtml}
<p style="margin-top:32px;font-size:12px;color:#5b6475">${SITE.name} · Companion academy to <em>${SITE.bookTitle}</em></p>
</div></body></html>`;
}

function codeBlock(code: string, url: string): string {
  return `<div style="margin:24px 0;padding:20px;border:2px solid #c48b2c;border-radius:12px;background:#fff;text-align:center">
<p style="margin:0;font-size:12px;letter-spacing:2px;color:#5b6475">GIFT CODE</p>
<p style="margin:8px 0 16px;font-family:Menlo,Consolas,monospace;font-size:22px;font-weight:bold;color:#0c1a33">${escapeHtml(code)}</p>
<a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 24px;border-radius:8px;background:#c48b2c;color:#070f1f;font-weight:bold;text-decoration:none">Redeem your membership</a>
</div>`;
}

/** The gift itself, sent to the recipient. */
export function recipientEmail(gift: GiftForEmail, appUrl: string): EmailMessage {
  if (!gift.recipientEmail) throw new Error("recipientEmail requires a recipient address");
  const term = GIFT_TERMS[gift.plan].label;
  const url = redeemUrl(appUrl, gift.code);
  const from = escapeHtml(gift.purchaserName);
  const message = gift.message
    ? `<blockquote style="margin:20px 0;padding:12px 16px;border-left:3px solid #c48b2c;background:#fff;font-style:italic">${escapeHtml(gift.message).replace(/\n/g, "<br>")}</blockquote>`
    : "";
  return {
    to: gift.recipientEmail,
    replyTo: gift.purchaserEmail,
    subject: `${gift.purchaserName} gave you ${term} of ${SITE.name}`,
    html: layout(`<h1 style="font-family:Georgia,serif;font-size:26px;color:#0c1a33;margin:0">${escapeHtml(gift.recipientName)}, you've received a gift</h1>
<p style="font-size:16px;line-height:1.5">${from} gave you <strong>${term}</strong> of ${SITE.name}: every course in the Professional Academy, the companion to <em>${SITE.bookTitle}</em>.</p>
${message}
${codeBlock(gift.code, url)}
<p style="font-size:14px;color:#5b6475">Your membership starts when you redeem it, not before. The code doesn't expire.</p>`),
    text: [
      `${gift.recipientName}, you've received a gift.`,
      "",
      `${gift.purchaserName} gave you ${term} of ${SITE.name}.`,
      ...(gift.message ? ["", `"${gift.message}"`] : []),
      "",
      `Gift code: ${gift.code}`,
      `Redeem: ${url}`,
      "",
      "Your membership starts when you redeem it. The code doesn't expire.",
    ].join("\n"),
  };
}

/** Confirmation for the purchaser, with the code so they can share it themselves. */
export function purchaserEmail(gift: GiftForEmail, appUrl: string): EmailMessage {
  const term = GIFT_TERMS[gift.plan].label;
  const url = redeemUrl(appUrl, gift.code);
  const deliveryNote = (name: string) =>
    gift.delivery === "self"
      ? `Here is the code to give to ${name} however you like: in a card, a text, or in person.`
      : gift.deliverAt && gift.deliverAt.getTime() > Date.now()
        ? `We'll email it to ${name} on ${formatDate(gift.deliverAt)}. The code is below in case you'd like to share it yourself.`
        : `We've emailed it to ${name}. The code is below in case it lands in a spam folder.`;
  const recipient = escapeHtml(gift.recipientName);
  return {
    to: gift.purchaserEmail,
    subject: `Your gift of ${SITE.name} for ${gift.recipientName}`,
    html: layout(`<h1 style="font-family:Georgia,serif;font-size:26px;color:#0c1a33;margin:0">Thank you for your gift</h1>
<p style="font-size:16px;line-height:1.5">You gave ${recipient} <strong>${term}</strong> of ${SITE.name}. ${deliveryNote(recipient)}</p>
${codeBlock(gift.code, url)}
<p style="font-size:14px;color:#5b6475">Gift memberships carry the same 7-day money-back guarantee as any membership. Just reply to this email.</p>`),
    text: [
      "Thank you for your gift.",
      "",
      `You gave ${gift.recipientName} ${term} of ${SITE.name}. ${deliveryNote(gift.recipientName)}`,
      "",
      `Gift code: ${gift.code}`,
      `Redeem: ${url}`,
    ].join("\n"),
  };
}
