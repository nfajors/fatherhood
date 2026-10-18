/** Emails about Fellow applications. Pure; user-supplied text is escaped. */
import { SITE } from "@/lib/config";
import type { EmailMessage } from "@/lib/email";

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export type FellowEmailInput = {
  name: string;
  email: string;
  decision: "approved" | "rejected";
  notes: string | null;
  /** Absolute URL of the Studio, for the approval email. */
  studioUrl: string;
};

export function fellowDecisionEmail(input: FellowEmailInput): EmailMessage {
  const approved = input.decision === "approved";
  const notes = input.notes?.trim() || null;
  const subject = approved ? `Welcome to the ${SITE.name} Fellows` : `Your ${SITE.name} Fellow application`;
  const lead = approved
    ? "You're now a Fellow. You can share your stories with fathers on Community Voices: videos of up to 8 minutes, uploaded from your phone or computer."
    : "Thank you for applying. We aren't able to offer Fellow access right now.";
  const notesLabel = approved ? "A note from our team" : "Why";
  const reply = "Questions? Just reply to this email.";
  return {
    to: input.email,
    subject,
    html: `<!doctype html><html><body style="margin:0;background:#fbfaf7;font-family:Helvetica,Arial,sans-serif;color:#121826">
<div style="max-width:560px;margin:0 auto;padding:32px 24px">
<p style="font-family:Georgia,serif;font-size:20px;font-weight:bold;color:#0c1a33;margin:0 0 24px">Fatherhood<span style="color:#c48b2c">.School</span></p>
<p style="font-size:16px">Hi ${escapeHtml(input.name)},</p>
<p style="font-size:16px;line-height:1.5">${lead}</p>
${notes ? `<p style="font-size:14px;color:#5b6475;margin-bottom:4px">${notesLabel}:</p><blockquote style="margin:0 0 16px;padding:12px 16px;border-left:3px solid #c48b2c;background:#fff">${escapeHtml(notes).replace(/\n/g, "<br>")}</blockquote>` : ""}
${approved ? `<p style="margin:24px 0"><a href="${escapeHtml(input.studioUrl)}" style="background:#c48b2c;color:#0c1a33;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:bold">Open your Studio</a></p>` : ""}
<p style="font-size:14px;color:#5b6475">${reply}</p>
<p style="margin-top:32px;font-size:12px;color:#5b6475">${SITE.name}</p>
</div></body></html>`,
    text: [
      `Hi ${input.name},`,
      "",
      lead,
      ...(notes ? ["", `${notesLabel}:`, notes] : []),
      ...(approved ? ["", `Open your Studio: ${input.studioUrl}`] : []),
      "",
      reply,
    ].join("\n"),
  };
}
