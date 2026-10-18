/**
 * Product constants from docs/development-plan.md. Change them here, not inline.
 */

export const SITE = {
  name: "Fatherhood.School",
  domain: "fatherhood.school",
  tagline: "Serious education for fathers and the men who will become them.",
  bookTitle: "Fatherhood in Focus",
} as const;

export type PlanId = "monthly" | "annual";

export const PLANS: Record<PlanId, { label: string; amountCents: number; interval: "month" | "year" }> = {
  monthly: { label: "Monthly", amountCents: 19_00, interval: "month" },
  annual: { label: "Annual", amountCents: 199_00, interval: "year" },
};

/** Days after purchase in which a member can request a full refund. */
export const MONEY_BACK_GUARANTEE_DAYS = 7;

/** Hard cap for Community Voices uploads, enforced by Cloudflare at upload time. */
export const COMMUNITY_MAX_DURATION_SECONDS = 8 * 60;

/** Upper bound for professional lessons (Stream requires a value; lessons run 8-20 min). */
export const PROFESSIONAL_MAX_DURATION_SECONDS = 2 * 60 * 60;

/** Largest file accepted per upload, a sanity cap; Stream bills by minutes, not bytes. */
export const MAX_UPLOAD_BYTES = { community: 5 * 1024 ** 3, professional: 30 * 1024 ** 3 } as const;

/**
 * Lifetime of signed playback tokens for paid content. Stream checks the token
 * as segments load, so it must outlast a paused-and-resumed lesson.
 */
export const SIGNED_PLAYBACK_TTL_SECONDS = 4 * 60 * 60;

export const CATEGORIES = [
  "Expectant",
  "New Dads",
  "School-age",
  "Teens",
  "Co-parenting",
  "Presence",
  "Discipline",
  "Work-Family",
  "Research",
  "Personal Stories",
] as const;

export type Category = (typeof CATEGORIES)[number];

/** Gift memberships are sold at the same prices as the plans they mirror. */
export const GIFT_TERMS: Record<PlanId, { label: string; months: number }> = {
  annual: { label: "1 year", months: 12 },
  monthly: { label: "1 month", months: 1 },
};

/** Longest personal message on a gift. */
export const GIFT_MESSAGE_MAX_CHARS = 500;
