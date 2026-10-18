/**
 * Signed links for unsubscribing without signing in. A token names one person
 * and never expires (unsubscribe links in old emails must keep working); it
 * only lets its holder change that person's email settings.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

function secret(): string {
  const value = process.env.EMAIL_TOKEN_SECRET || process.env.BETTER_AUTH_SECRET;
  if (!value) throw new Error("Set EMAIL_TOKEN_SECRET (or BETTER_AUTH_SECRET) to sign unsubscribe links.");
  return value;
}

const sign = (userId: string, key: string) => createHmac("sha256", key).update(`email-settings:${userId}`).digest("base64url").slice(0, 32);

export function emailToken(userId: string, key: string = secret()): string {
  return `${Buffer.from(userId).toString("base64url")}.${sign(userId, key)}`;
}

/** The person a token belongs to, or null if it's malformed or forged. */
export function verifyEmailToken(token: string | null | undefined, key: string = secret()): string | null {
  if (!token) return null;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  const userId = Buffer.from(encoded, "base64url").toString();
  if (!userId) return null;
  const expected = Buffer.from(sign(userId, key));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given) ? userId : null;
}
