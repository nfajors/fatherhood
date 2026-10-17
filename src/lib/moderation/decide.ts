/**
 * What happens after the AI screen. Pure and unit-tested: auto-approve only in
 * the narrow case the policy allows; everything else goes to a person, ordered
 * by risk.
 */
import type { AiRisk, VideoType } from "@/lib/db/schema";
import { MODERATION_POLICY as P } from "./policy";
import type { RiskLevel, ScreenResult } from "./screen";

export type Priority = "urgent" | "high" | "normal";

export type Decision = {
  autoApprove: boolean;
  risk: AiRisk;
  priority: Priority;
  /** Why it was or wasn't auto-approved, for the review page. */
  reasons: string[];
};

const RANK: Record<RiskLevel, number> = { none: 0, low: 0, medium: 1, high: 2 };

/** Overall risk: the worst category. A declined screen counts as high. */
export function overallRisk(result: ScreenResult): AiRisk {
  if (result.kind === "declined") return "high";
  const worst = Math.max(...Object.values(result.categories).map((l) => RANK[l]));
  return worst >= 2 ? "high" : worst === 1 ? "medium" : "low";
}

export function decide(input: {
  type: VideoType;
  result: ScreenResult;
  /** Has a person approved one of this creator's videos before? */
  creatorHasHumanApproval: boolean;
}): Decision {
  const { result } = input;
  const risk = overallRisk(result);
  const priority: Priority =
    risk === "high" ? "urgent" : risk === "medium" || (result.kind === "screened" && result.recommendation === "reject") ? "high" : "normal";

  const reasons: string[] = [];
  const rules = P.autoApprove;
  if (!rules.enabled) reasons.push("Auto-approval is turned off.");
  if (input.type !== "community") reasons.push("Professional videos always get a human review.");
  if (result.kind === "declined") {
    reasons.push("The AI declined to assess this video, so a person must review it.");
  } else {
    if (result.recommendation !== "approve") reasons.push(`The AI recommends "${result.recommendation}".`);
    if (risk !== "low") reasons.push(`The AI rated it ${risk} risk.`);
    if (result.relevance < rules.minRelevance) reasons.push(`Relevance ${result.relevance} is below ${rules.minRelevance}.`);
    if (rules.requireTranscript && !result.hadTranscript) reasons.push("No transcript was available, so the AI couldn't hear it.");
  }
  if (rules.requirePriorHumanApproval && !input.creatorHasHumanApproval) {
    reasons.push("This creator's first video needs a human review.");
  }

  return { autoApprove: reasons.length === 0, risk, priority, reasons };
}

/** Review deadline for a video entering the queue. */
export function reviewDueAt(type: VideoType, from: Date): Date {
  return new Date(from.getTime() + P.reviewSlaHours[type] * 60 * 60 * 1000);
}

export type SlaState = "overdue" | "due_soon" | "on_track";

export function slaState(dueAt: Date | null, now: Date = new Date()): SlaState {
  if (!dueAt) return "on_track";
  const msLeft = dueAt.getTime() - now.getTime();
  if (msLeft < 0) return "overdue";
  return msLeft < P.dueSoonHours * 60 * 60 * 1000 ? "due_soon" : "on_track";
}

/** Queue order key, lowest first: urgent, then high, then normal. Ties break on the review deadline. */
export function priorityRank(risk: AiRisk | null, recommendation: string | null): number {
  if (risk === "high") return 0;
  if (risk === "medium" || recommendation === "reject") return 1;
  return 2;
}
