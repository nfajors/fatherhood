/**
 * The scheduled jobs and when each is due. The scheduler (scripts/cron-tick.mjs)
 * runs every 5 minutes and calls the jobs due in that 5-minute slot. All times UTC.
 * Every job is safe to run twice, so a repeated or overlapping tick is harmless.
 */

/** @typedef {{ name: string; path: string; due: (slot: { minute: number; hour: number; day: number }) => boolean }} Job */

/** @type {Job[]} */
export const JOBS = [
  // AI pre-screen of new uploads, and review deadlines.
  { name: "moderation", path: "/api/cron/moderation", due: ({ minute }) => minute % 10 === 0 },
  // Welcome, new-member, come-back and win-back emails.
  { name: "email-sequences", path: "/api/cron/email-sequences", due: ({ minute }) => minute % 15 === 0 },
  // Scheduled gift emails, and retries of failed ones.
  { name: "gift-delivery", path: "/api/cron/gift-delivery", due: ({ minute }) => minute === 0 },
  // Creator payout reminders and (with PAYOUTS_AUTO_SEND) sending, daily at 16:00.
  { name: "payouts", path: "/api/cron/payouts", due: ({ minute, hour }) => hour === 16 && minute === 0 },
  // Last month's creator pool, at 12:00 on the 2nd; the 3rd and 4th catch a missed run (settling twice returns the stored result).
  { name: "revenue-settlement", path: "/api/cron/revenue-settlement", due: ({ minute, hour, day }) => day >= 2 && day <= 4 && hour === 12 && minute === 0 },
];

/** The jobs due in the 5-minute slot containing `at`. */
export function dueJobs(at) {
  const slot = { minute: Math.floor(at.getUTCMinutes() / 5) * 5, hour: at.getUTCHours(), day: at.getUTCDate() };
  return JOBS.filter((job) => job.due(slot));
}
