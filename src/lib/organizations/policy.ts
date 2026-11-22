/**
 * Organization licensing (development plan, Phase 3: "B2B licensing portal").
 * Sold on contract: our team sets seats, term and price per organization, and
 * the organization pays a Stripe invoice. Revenue funds the creator pool like
 * memberships do.
 */
import type { OrganizationKind } from "@/lib/db/schema";

export const ORG_POLICY = {
  /** Invitation links work this long. */
  inviteDays: 30,
  /** Default payment terms on an invoice. */
  defaultDaysUntilDue: 30,
  /**
   * Progress totals include fathers who don't share only when at least this many
   * don't share, so totals minus the sharers' figures can't reveal one father.
   */
  privacyGroupSize: 5,
  maxInvitesPerBatch: 200,
} as const;

export const ORG_KINDS: Record<OrganizationKind, string> = {
  nonprofit: "Nonprofit or fatherhood program",
  employer: "Employer",
  university: "University or school",
  military: "Military",
  government: "Government or court program",
  faith: "Faith community",
  healthcare: "Healthcare",
  other: "Other",
};
