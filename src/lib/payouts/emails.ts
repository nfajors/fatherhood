/** Emails to creators about payouts. Pure; user-supplied text is escaped. These are account emails, always sent. */
import { SITE } from "@/lib/config";
import type { EmailMessage } from "@/lib/email";
import { formatMoney } from "@/lib/format";

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export type PayoutEmailInput = {
  name: string;
  email: string;
  amountCents: number;
  /** Absolute URL of the Studio earnings page. */
  earningsUrl: string;
};

function shell(name: string, paragraphs: string[], cta: { label: string; url: string }): string {
  return `<!doctype html><html><body style="margin:0;background:#fbfaf7;font-family:Helvetica,Arial,sans-serif;color:#121826">
<div style="max-width:560px;margin:0 auto;padding:32px 24px">
<p style="font-family:Georgia,serif;font-size:20px;font-weight:bold;color:#0c1a33;margin:0 0 24px">Fatherhood<span style="color:#c48b2c">.School</span></p>
<p style="font-size:16px">Hi ${escapeHtml(name)},</p>
${paragraphs.map((p) => `<p style="font-size:16px;line-height:1.5">${p}</p>`).join("\n")}
<p style="margin:24px 0"><a href="${escapeHtml(cta.url)}" style="background:#c48b2c;color:#0c1a33;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:bold">${cta.label}</a></p>
<p style="font-size:14px;color:#5b6475">Questions? Just reply to this email.</p>
<p style="margin-top:32px;font-size:12px;color:#5b6475">${SITE.name}</p>
</div></body></html>`;
}

/** Sent when a transfer goes through. */
export function payoutSentEmail(input: PayoutEmailInput): EmailMessage {
  const amount = formatMoney(input.amountCents);
  const lead = `We've sent your creator pool payout of ${amount} to your Stripe account.`;
  const timing = "Stripe deposits it in your bank account on your payout schedule, usually within a few business days.";
  const thanks = "Thank you for what you share with fathers on Community Voices.";
  return {
    to: input.email,
    subject: `Your ${SITE.name} payout of ${amount} is on its way`,
    html: shell(input.name, [`We've sent your creator pool payout of <strong>${amount}</strong> to your Stripe account.`, timing, thanks], {
      label: "See your earnings",
      url: input.earningsUrl,
    }),
    text: [`Hi ${input.name},`, "", lead, timing, "", thanks, "", `See your earnings: ${input.earningsUrl}`, "", "Questions? Just reply to this email."].join("\n"),
  };
}

/** Sent once per payout when it is waiting for the creator to set up (or finish setting up) payouts. */
export function payoutSetupEmail(input: PayoutEmailInput & { started: boolean }): EmailMessage {
  const amount = formatMoney(input.amountCents);
  const lead = `You have a creator pool payout of ${amount} waiting.`;
  const ask = input.started
    ? "Stripe needs a little more information before we can send it. It only takes a few minutes."
    : "To receive it, set up payouts with Stripe, our payments partner. It takes a few minutes: your name, a bank account and tax details.";
  const keep = "Your payout stays reserved for you until then.";
  const label = input.started ? "Finish setting up payouts" : "Set up payouts";
  return {
    to: input.email,
    subject: `${amount} is waiting for you on ${SITE.name}`,
    html: shell(input.name, [`You have a creator pool payout of <strong>${amount}</strong> waiting.`, ask, keep], { label, url: input.earningsUrl }),
    text: [`Hi ${input.name},`, "", lead, ask, keep, "", `${label}: ${input.earningsUrl}`, "", "Questions? Just reply to this email."].join("\n"),
  };
}
