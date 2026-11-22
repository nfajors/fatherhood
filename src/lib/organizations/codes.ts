/** Invitation tokens and organization join codes. */
import { createHash, randomBytes, randomInt } from "node:crypto";

/** A one-time invitation token for a link, and the hash we store (the token itself is never saved). */
export function newInviteToken(): { token: string; hash: string } {
  const token = randomBytes(24).toString("base64url");
  return { token, hash: hashInviteToken(token) };
}

export const hashInviteToken = (token: string) => createHash("sha256").update(token).digest("hex");

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A join code like ORG-7K3M-9QPX: no look-alike characters, easy to read out in a room. */
export function newJoinCode(random: (max: number) => number = randomInt): string {
  let chars = "";
  for (let i = 0; i < 8; i++) chars += ALPHABET[random(ALPHABET.length)];
  return `ORG-${chars.slice(0, 4)}-${chars.slice(4)}`;
}

/** What someone typed, in the stored form, or null if it can't be a join code. */
export function normalizeJoinCode(input: string): string | null {
  let compact = input.toUpperCase().replace(/[\s-]/g, "");
  if (compact.startsWith("ORG")) compact = compact.slice(3);
  if (compact.length !== 8 || [...compact].some((c) => !ALPHABET.includes(c))) return null;
  return `ORG-${compact.slice(0, 4)}-${compact.slice(4)}`;
}

/** Lowercased, trimmed addresses from a pasted list (commas, semicolons, spaces or new lines), valid ones only, once each. */
export function parseEmails(text: string): { valid: string[]; invalid: string[] } {
  const parts = text
    .split(/[\s,;]+/)
    .map((p) => p.trim().replace(/^<|>$/g, "").toLowerCase())
    .filter(Boolean);
  const valid = new Set<string>();
  const invalid: string[] = [];
  for (const p of parts) {
    if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(p)) valid.add(p);
    else invalid.push(p);
  }
  return { valid: [...valid], invalid };
}
