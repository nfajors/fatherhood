/**
 * Creator payouts through Stripe Connect (Express accounts). The amounts come
 * from monthly settlement (lib/revenue); this module only moves the money.
 */
export const PAYOUT_POLICY = {
  currency: "usd",
  /** Express accounts are created in this country; US-only for now. */
  accountCountry: "US",
  /**
   * Automatic sending waits this long after a payout is created, so an admin can
   * review a settlement (and re-run it with --force) before money moves.
   * "Send now" in the admin ignores the hold.
   */
  holdDays: 3,
  /** A "processing" payout whose attempt started longer ago than this is checked with Stripe and retried. */
  attemptLeaseMinutes: 15,
  /** At most this many payouts per automatic run, to stay well inside a cron's time limit. */
  maxPerRun: 50,
} as const;
