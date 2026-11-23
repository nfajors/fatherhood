/**
 * Password reset, and "set a password" for people who signed up with Google
 * (the reset creates the password sign-in, which the phone app needs).
 * Better Auth makes the one-time link (an hour); this writes the email and
 * stops one address being flooded with links.
 */
import { and, count, eq, gt, like } from "drizzle-orm";
import { SITE } from "@/lib/config";
import type { Database } from "@/lib/db";
import { account, verification } from "@/lib/db/schema";
import type { EmailMessage } from "@/lib/email";

export const RESET_POLICY = {
  /** How long a link works. */
  linkMinutes: 60,
  /** At most this many links per account in `windowMinutes` (Better Auth also limits each IP). */
  maxLinks: 3,
  windowMinutes: 15,
} as const;

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** True when the person has a password; false when he only signs in with Google. */
export async function hasPassword(db: Database, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ n: count() })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, "credential")));
  return (row?.n ?? 0) > 0;
}

/**
 * Whether to email this link. Better Auth has already stored it (so the latest
 * counts); beyond the limit the request still looks the same to the person
 * asking, but no email goes out.
 */
export async function shouldSendReset(db: Database, userId: string, now: Date = new Date()): Promise<boolean> {
  const since = new Date(now.getTime() - RESET_POLICY.windowMinutes * 60_000);
  const [row] = await db
    .select({ n: count() })
    .from(verification)
    .where(and(eq(verification.value, userId), like(verification.identifier, "reset-password:%"), gt(verification.createdAt, since)));
  return (row?.n ?? 0) <= RESET_POLICY.maxLinks;
}

export function resetPasswordEmail(input: { to: string; name: string; url: string; hasPassword: boolean }): EmailMessage {
  const first = input.name.trim().split(/\s+/)[0] || "there";
  const subject = input.hasPassword ? `Reset your ${SITE.name} password` : `Set a password for ${SITE.name}`;
  const lead = input.hasPassword
    ? "Someone (we hope you) asked to reset the password for your account. Choose a new one with the button below."
    : "You sign in to your account with Google. To sign in with your email and a password as well (in the iPhone and Android app, for example), choose a password with the button below. Google sign-in keeps working.";
  const cta = input.hasPassword ? "Choose a new password" : "Set a password";
  const note = `The link works for ${RESET_POLICY.linkMinutes} minutes and only once. If you didn't ask for this, ignore this email: nothing changes.`;
  const html = `<!doctype html><html><body style="margin:0;background:#fbfaf7;font-family:Helvetica,Arial,sans-serif;color:#121826">
<div style="max-width:560px;margin:0 auto;padding:32px 24px">
<p style="font-family:Georgia,serif;font-size:20px;font-weight:bold;color:#0c1a33;margin:0 0 24px">Fatherhood<span style="color:#c48b2c">.School</span></p>
<p style="font-size:16px;line-height:1.5">Hi ${escapeHtml(first)},</p>
<p style="font-size:16px;line-height:1.5">${escapeHtml(lead)}</p>
<p style="margin:24px 0"><a href="${escapeHtml(input.url)}" style="background:#c48b2c;color:#0c1a33;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:bold">${cta}</a></p>
<p style="font-size:14px;line-height:1.5;color:#5b6475">${escapeHtml(note)}</p>
<p style="margin-top:32px;font-size:12px;color:#5b6475">${SITE.name}</p>
</div></body></html>`;
  return {
    to: input.to,
    subject,
    html,
    text: [`Hi ${first},`, "", lead, "", `${cta}: ${input.url}`, "", note].join("\n"),
  };
}
