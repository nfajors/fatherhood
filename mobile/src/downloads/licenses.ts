/**
 * Offline downloads: what's on the phone and whether it may still play. The
 * server licenses each download for 30 days and renews it whenever the app
 * checks in; a file whose license has run out (or was revoked) is deleted.
 */
import type { AppTarget } from "../api/types";

export type DownloadRecord = {
  videoId: string;
  title: string;
  /** Course title, or "Community Voices". */
  context: string;
  durationSeconds: number | null;
  target: AppTarget;
  fileName: string;
  sizeBytes: number;
  licenseExpiresAt: string;
  downloadedAt: string;
  lastCheckedAt: string;
};

export type LicenseCheck = { videoId: string; status: "valid"; licenseExpiresAt: string } | { videoId: string; status: "revoked" };

/** Check in at most this often while online. */
export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

export const isPlayable = (record: DownloadRecord, now: Date) => new Date(record.licenseExpiresAt).getTime() > now.getTime();

export const needsCheck = (records: DownloadRecord[], now: Date) =>
  records.some((r) => now.getTime() - new Date(r.lastCheckedAt).getTime() >= CHECK_EVERY_MS);

/** Whole days of offline viewing left (0 on the last day). */
export function daysLeft(record: DownloadRecord, now: Date): number {
  return Math.max(0, Math.floor((new Date(record.licenseExpiresAt).getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));
}

/** Split records into those to keep and those whose files must go: run out, or not in the server's answer as valid. */
export function applyChecks(records: DownloadRecord[], checks: LicenseCheck[] | null, now: Date): { keep: DownloadRecord[]; remove: DownloadRecord[] } {
  const keep: DownloadRecord[] = [];
  const remove: DownloadRecord[] = [];
  for (const record of records) {
    let next = record;
    if (checks) {
      const check = checks.find((c) => c.videoId === record.videoId);
      // A record the server didn't answer for is left as it is until the next check.
      if (check?.status === "revoked") {
        remove.push(record);
        continue;
      }
      if (check?.status === "valid") next = { ...record, licenseExpiresAt: check.licenseExpiresAt, lastCheckedAt: now.toISOString() };
    }
    (isPlayable(next, now) ? keep : remove).push(next);
  }
  return { keep, remove };
}
