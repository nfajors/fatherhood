/**
 * Gift codes: FATHER-XXXX-XXXX from an alphabet without look-alike characters
 * (no 0/O, 1/I/L, U), so codes survive being read aloud or copied from a card.
 * 8 random characters from 30 gives about 6.6e11 codes.
 */
import { randomInt } from "node:crypto";

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
const PREFIX = "FATHER";
const LENGTH = 8;

export function generateGiftCode(random: (max: number) => number = randomInt): string {
  let chars = "";
  for (let i = 0; i < LENGTH; i++) chars += ALPHABET[random(ALPHABET.length)];
  return `${PREFIX}-${chars.slice(0, 4)}-${chars.slice(4)}`;
}

/**
 * Normalize what someone typed into the stored form, or null if it can't be a
 * code. Accepts lowercase, spaces, missing dashes and a missing prefix.
 * Characters outside the alphabet are rejected rather than guessed at.
 */
export function normalizeGiftCode(input: string): string | null {
  let compact = input.toUpperCase().replace(/[\s-]/g, "");
  if (compact.startsWith(PREFIX)) compact = compact.slice(PREFIX.length);
  if (compact.length !== LENGTH) return null;
  for (const ch of compact) if (!ALPHABET.includes(ch)) return null;
  return `${PREFIX}-${compact.slice(0, 4)}-${compact.slice(4)}`;
}
