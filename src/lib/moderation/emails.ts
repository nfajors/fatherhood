/** Emails to creators about review decisions. Pure; user-supplied text is escaped. */
import { SITE } from "@/lib/config";
import type { EmailMessage } from "@/lib/email";

export type DecisionEmailInput = {
  creatorName: string;
  creatorEmail: string;
  videoTitle: string;
  decision: "approved" | "rejected" | "changes_requested" | "unpublished";
  notes: string | null;
};

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const COPY: Record<DecisionEmailInput["decision"], { subject: (t: string) => string; lead: string; notesLabel: string }> = {
  approved: {
    subject: (t) => `Your video "${t}" is live`,
    lead: "Thank you for sharing it. It's now published on Fatherhood.School for fathers to watch.",
    notesLabel: "A note from the reviewer",
  },
  changes_requested: {
    subject: (t) => `Changes requested for "${t}"`,
    lead: "Our reviewers would like a few changes before it can be published.",
    notesLabel: "What to change",
  },
  rejected: {
    subject: (t) => `Update on your video "${t}"`,
    lead: "After review, we aren't able to publish this video.",
    notesLabel: "Why",
  },
  unpublished: {
    subject: (t) => `Your video "${t}" has been taken down`,
    lead: "After a review, this video is no longer published.",
    notesLabel: "Why",
  },
};

export function decisionEmail(input: DecisionEmailInput): EmailMessage {
  const copy = COPY[input.decision];
  const notes = input.notes?.trim() || null;
  const reply = "Questions? Just reply to this email.";
  return {
    to: input.creatorEmail,
    subject: copy.subject(input.videoTitle),
    html: `<!doctype html><html><body style="margin:0;background:#fbfaf7;font-family:Helvetica,Arial,sans-serif;color:#121826">
<div style="max-width:560px;margin:0 auto;padding:32px 24px">
<p style="font-family:Georgia,serif;font-size:20px;font-weight:bold;color:#0c1a33;margin:0 0 24px">Fatherhood<span style="color:#c48b2c">.School</span></p>
<p style="font-size:16px">Hi ${escapeHtml(input.creatorName)},</p>
<p style="font-size:16px;line-height:1.5">About <strong>${escapeHtml(input.videoTitle)}</strong>: ${copy.lead}</p>
${notes ? `<p style="font-size:14px;color:#5b6475;margin-bottom:4px">${copy.notesLabel}:</p><blockquote style="margin:0 0 16px;padding:12px 16px;border-left:3px solid #c48b2c;background:#fff">${escapeHtml(notes).replace(/\n/g, "<br>")}</blockquote>` : ""}
<p style="font-size:14px;color:#5b6475">${reply}</p>
<p style="margin-top:32px;font-size:12px;color:#5b6475">${SITE.name}</p>
</div></body></html>`,
    text: [`Hi ${input.creatorName},`, "", `About "${input.videoTitle}": ${copy.lead}`, ...(notes ? ["", `${copy.notesLabel}:`, notes] : []), "", reply].join("\n"),
  };
}
