/** Rules for the mobile app. */
export const MOBILE_POLICY = {
  /** How long a downloaded video plays offline before the app must check in again. */
  offlineLicenseDays: 30,
  /** Downloads a member can hold at once, across his devices. */
  maxOfflineDownloads: 40,
  /** How long the signed MP4 link is good for (long enough for a slow connection). */
  downloadUrlTtlSeconds: 6 * 60 * 60,
  /** Offline progress records accepted in one sync. */
  maxProgressSync: 200,
} as const;

export const licenseExpiry = (now: Date) => new Date(now.getTime() + MOBILE_POLICY.offlineLicenseDays * 24 * 60 * 60 * 1000);
