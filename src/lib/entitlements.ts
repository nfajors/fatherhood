/**
 * Who may watch what. Pure functions so every rule is unit-tested; callers load
 * the rows and pass them in.
 *
 * Rules (docs/development-plan.md sections 3.1 and 5.3):
 * - Approved Community videos are free to everyone, signed in or not.
 * - Approved Professional videos need an active membership, unless the lesson
 *   is marked as a free preview.
 * - Anything not yet approved is visible only to its creator and admins.
 */
import type { SubscriptionStatus, UserRole, VideoStatus, VideoType } from "@/lib/db/schema";

/**
 * Statuses that keep access open. past_due is included because Stripe is still
 * retrying the card; access ends when Stripe gives up and marks it unpaid or canceled.
 */
const ACCESS_STATUSES: ReadonlySet<SubscriptionStatus> = new Set(["active", "trialing", "past_due"]);

export type MembershipRecord = {
  status: SubscriptionStatus;
  currentPeriodEnd: Date;
};

export type Viewer = {
  id: string;
  role: UserRole;
  memberships: MembershipRecord[];
} | null;

export type PlayableVideo = {
  type: VideoType;
  status: VideoStatus;
  creatorId: string;
};

export type AccessDecision =
  | { allowed: true; signed: boolean }
  | { allowed: false; reason: "not_published" | "sign_in_required" | "membership_required" };

/** True when any membership grants access at `now`. */
export function hasActiveMembership(memberships: MembershipRecord[], now: Date = new Date()): boolean {
  return memberships.some((m) => ACCESS_STATUSES.has(m.status) && m.currentPeriodEnd.getTime() > now.getTime());
}

/**
 * Decide whether `viewer` may play `video`. `signed` says whether playback must
 * use a short-lived signed token (all Professional content) or the public URL.
 */
export function canWatch(
  video: PlayableVideo,
  viewer: Viewer,
  options: { isPreviewLesson?: boolean; now?: Date } = {},
): AccessDecision {
  const signed = video.type === "professional";
  const isOwnerOrAdmin = viewer !== null && (viewer.role === "admin" || viewer.id === video.creatorId);

  if (video.status !== "approved") {
    return isOwnerOrAdmin ? { allowed: true, signed } : { allowed: false, reason: "not_published" };
  }

  if (video.type === "community" || options.isPreviewLesson || isOwnerOrAdmin) {
    return { allowed: true, signed };
  }

  if (viewer === null) return { allowed: false, reason: "sign_in_required" };

  return hasActiveMembership(viewer.memberships, options.now)
    ? { allowed: true, signed }
    : { allowed: false, reason: "membership_required" };
}

/** Upload rights: Fellows (creators) post Community videos; only admins post Professional. */
export function canUpload(role: UserRole, type: VideoType): boolean {
  if (role === "admin") return true;
  return role === "creator" && type === "community";
}
