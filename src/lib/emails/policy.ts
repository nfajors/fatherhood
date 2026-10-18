import type { EmailCategory } from "@/lib/db/schema";

/** Timing for sequences and notifications. */
export const EMAIL_POLICY = {
  /** New accounts younger than this get the welcome series (so a deploy doesn't email old accounts). */
  welcomeWindowDays: 3,
  /** Memberships that started within this many days get member onboarding. */
  onboardingWindowDays: 7,
  /** A member with no watching for this long gets a nudge... */
  inactiveDays: 14,
  /** ...at most this often. */
  reengageCooldownDays: 30,
  /** Win-back starts this many days after a membership ends, and not for endings older than the window. */
  winbackDelayDays: 3,
  winbackWindowDays: 30,
  /** At most one reply email per conversation per person in this many hours. */
  replyWindowHours: 6,
  /** Emails per cron run, and how long one is held while it sends. */
  batchSize: 100,
  leaseMinutes: 15,
  /** Failed sends of a step are retried this many times before it's skipped. */
  maxAttempts: 3,
} as const;

export const CATEGORY_LABELS: Record<EmailCategory, { label: string; description: string }> = {
  learning: {
    label: "Getting started and staying on track",
    description: "Where to begin as a new member, and a nudge to pick up where you left off.",
  },
  announcements: {
    label: "New courses and news",
    description: "New courses and occasional news from Fatherhood.School.",
  },
  replies: {
    label: "Replies to your comments",
    description: "When someone replies to something you wrote.",
  },
};

export const EMAIL_CATEGORIES = Object.keys(CATEGORY_LABELS) as EmailCategory[];
