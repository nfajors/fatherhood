/**
 * Watch-time rules. The player reports how long it has been playing; the
 * server credits no more than the real time since the last heartbeat, so a
 * modified client can't inflate views or creator earnings.
 */
import { REVENUE_POLICY } from "@/lib/revenue/policy";

export const PLAYBACK_POLICY = {
  /** How often the player reports while playing. */
  heartbeatSeconds: 15,
  /** Slack for network delay when comparing reported watch time with real time. */
  creditSlackSeconds: 5,
  /** Most a single heartbeat can credit, however long the gap. */
  maxCreditPerHeartbeatSeconds: 60,
  /** A video counts as finished at this share of its length, or within the last 30 seconds. */
  completeAtFraction: 0.9,
  completeWithinSecondsOfEnd: 30,
  /** A session becomes a "view" (view count, creator pool) at this much watching. */
  viewThresholdSeconds: REVENUE_POLICY.minWatchSecondsPerView,
} as const;

const P = PLAYBACK_POLICY;

/** Seconds to credit for a heartbeat claiming `claimed` seconds since `lastHeartbeatAt`. */
export function creditWatchTime(claimed: number, lastHeartbeatAt: Date, now: Date): number {
  if (!Number.isFinite(claimed) || claimed <= 0) return 0;
  const elapsed = Math.max(0, (now.getTime() - lastHeartbeatAt.getTime()) / 1000);
  return Math.floor(Math.min(claimed, elapsed + P.creditSlackSeconds, P.maxCreditPerHeartbeatSeconds));
}

export function isComplete(positionSeconds: number, durationSeconds: number | null, ended = false): boolean {
  if (ended) return true;
  if (!durationSeconds || durationSeconds <= 0) return false;
  return positionSeconds >= durationSeconds * P.completeAtFraction || durationSeconds - positionSeconds <= P.completeWithinSecondsOfEnd;
}

/** Where to resume: the saved position, unless the video was finished or nearly so (then start over). */
export function resumeAt(positionSeconds: number | null, durationSeconds: number | null, completed: boolean): number {
  if (!positionSeconds || completed) return 0;
  if (durationSeconds && durationSeconds - positionSeconds < 10) return 0;
  return Math.max(0, Math.floor(positionSeconds - 3)); // a few seconds of context
}

/** True when this heartbeat carried the session over the view threshold. */
export function becameView(before: number, after: number): boolean {
  return before < P.viewThresholdSeconds && after >= P.viewThresholdSeconds;
}

/** Share of lessons completed, 0-100. */
export function percentComplete(completed: number, total: number): number {
  return total > 0 ? Math.round((completed / total) * 100) : 0;
}
