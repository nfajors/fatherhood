/** Invitation emails. Pure; organization names and notes are escaped. These are account emails, always sent. */
import { SITE } from "@/lib/config";
import type { EmailMessage } from "@/lib/email";

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function inviteEmail(input: { email: string; organization: string; asManager: boolean; link: string; expiresOn: string }): EmailMessage {
  const org = input.organization;
  const subject = input.asManager ? `Manage ${org} on ${SITE.name}` : `${org} has given you ${SITE.name}`;
  const lead = input.asManager
    ? `You've been asked to manage ${org}'s account on ${SITE.name}: invite fathers, see how many have joined and how the group is doing.`
    : `${org} is giving you full access to ${SITE.name}, an online academy for fathers: every course, the Community Voices stories from other dads, and a personal coach.`;
  const privacy = input.asManager
    ? null
    : `When you join, you choose whether ${org} can see your name and progress. Your conversations with the coach are always private.`;
  const cta = input.asManager ? "Open the account" : "Accept and join";
  const html = `<!doctype html><html><body style="margin:0;background:#fbfaf7;font-family:Helvetica,Arial,sans-serif;color:#121826">
<div style="max-width:560px;margin:0 auto;padding:32px 24px">
<p style="font-family:Georgia,serif;font-size:20px;font-weight:bold;color:#0c1a33;margin:0 0 24px">Fatherhood<span style="color:#c48b2c">.School</span></p>
<p style="font-size:16px;line-height:1.5">${escapeHtml(lead)}</p>
${privacy ? `<p style="font-size:15px;line-height:1.5;color:#5b6475">${escapeHtml(privacy)}</p>` : ""}
<p style="margin:24px 0"><a href="${escapeHtml(input.link)}" style="background:#c48b2c;color:#0c1a33;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:bold">${cta}</a></p>
<p style="font-size:14px;color:#5b6475">This invitation works until ${escapeHtml(input.expiresOn)}. Questions? Just reply to this email.</p>
<p style="margin-top:32px;font-size:12px;color:#5b6475">${SITE.name}</p>
</div></body></html>`;
  return {
    to: input.email,
    subject,
    html,
    text: [lead, ...(privacy ? ["", privacy] : []), "", `${cta}: ${input.link}`, "", `This invitation works until ${input.expiresOn}.`].join("\n"),
  };
}
