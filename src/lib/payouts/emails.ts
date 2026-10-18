/** Payout emails to creators. Transactional (always sent). Pure; names are escaped. */
import { SITE } from "@/lib/config";
import type { EmailMessage } from "@/lib/email";
import { formatMoney } from "@/lib/format";

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function message(input: { to: string; name: string; subject: string; paragraphs: string[]; button: { label: string; url: string } }): EmailMessage {
  const first = input.name.trim().split(/\s+/)[0] || "there";
  return {
    to: input.to,
    subject: input.subject,
    html: `<!doctype html><html><body style="margin:0;background:#fbfaf7;font-family:Helvetica,Arial,sans-serif;color:#121826">
<div style="max-width:560px;margin:0 auto;padding:32px 24px">
<p style="font-family:Georgia,serif;font-size:20px;font-weight:bold;color:#0c1a33;margin:0 0 24px">Fatherhood<span style="color:#c48b2c">.School</span></p>
<p style="font-size:16px">Hi ${escapeHtml(first)},</p>
${input.paragraphs.map((p) => `<p style="font-size:16px;line-height:1.5">${escapeHtml(p)}</p>`).join("\n")}
<p style="margin:24px 0"><a href="${escapeHtml(input.button.url)}" style="background:#c48b2c;color:#0c1a33;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:bold">${escapeHtml(input.button.label)}</a></p>
<p style="font-size:14px;color:#5b6475">Questions? Just reply to this email.</p>
<p style="margin-top:32px;font-size:12px;color:#5b6475">${SITE.name}</p>
</div></body></html>`,
    text: [`Hi ${first},`, "", ...input.paragraphs.flatMap((p) => [p, ""]), `${input.button.label}: ${input.button.url}`, "", "Questions? Just reply to this email."].join("\n"),
  };
}

export function payoutSentEmail(input: { to: string; name: string; amountCents: number; earningsUrl: string; idempotencyKey: string }): EmailMessage {
  return {
    ...message({
      to: input.to,
      name: input.name,
      subject: `You've been paid ${formatMoney(input.amountCents)}`,
      paragraphs: [
        `We've sent ${formatMoney(input.amountCents)} from the ${SITE.name} creator pool to your Stripe account. Stripe moves it to your bank on its usual schedule, usually within two business days.`,
        "Thank you for sharing your stories with other fathers.",
      ],
      button: { label: "See your earnings", url: input.earningsUrl },
    }),
    idempotencyKey: input.idempotencyKey,
  };
}

export function payoutSetupEmail(input: { to: string; name: string; amountCents: number; earningsUrl: string }): EmailMessage {
  return message({
    to: input.to,
    name: input.name,
    subject: `Set up payouts to receive ${formatMoney(input.amountCents)}`,
    paragraphs: [
      `You have ${formatMoney(input.amountCents)} from the ${SITE.name} creator pool waiting for you.`,
      "To receive it, set up payouts in your Studio. Stripe, our payments partner, asks for your bank details and tax information. It takes about five minutes, and we never see your bank details.",
    ],
    button: { label: "Set up payouts", url: input.earningsUrl },
  });
}
