/** Moderation rules (docs/development-plan.md 3.4). Change them here, not inline. */
export const MODERATION_POLICY = {
  model: "claude-opus-5-5",

  /** Review deadlines from when a video enters the queue. */
  reviewSlaHours: { community: 48, professional: 120 },
  /** Show a "due soon" warning this long before the deadline. */
  dueSoonHours: 24,

  /** Auto-approval applies only to Community videos; professional content always gets a human review. */
  autoApprove: {
    enabled: true,
    /** Minimum relevance to fatherhood, 0-100. */
    minRelevance: 80,
    /** The AI must have heard the video, not just read its title. */
    requireTranscript: true,
    /** A creator's first video always gets a human review. */
    requirePriorHumanApproval: true,
  },

  /** Frames sent to the AI, as fractions of the video's length. */
  framePositions: [0.1, 0.35, 0.6, 0.85],
  /** How long to wait for Stream captions before screening without a transcript. */
  captionWaitMinutes: 30,
  maxTranscriptChars: 12_000,

  /** Distinct open reports that hide a published video until an admin reviews it. */
  reportHideThreshold: 3,
} as const;

/** Policy areas the AI rates, from the plan's content policy. */
export const RISK_CATEGORIES = {
  sexual: "Sexual content or nudity",
  violence: "Graphic violence or threats",
  hate_or_harassment: "Hate, harassment or demeaning content",
  self_harm: "Self-harm or suicide",
  dangerous_or_illegal: "Dangerous or illegal activity",
  spam_or_promotion: "Spam, scams or self-promotion",
  culture_war_politics: "Partisan or culture-war politics not tied to fatherhood evidence",
  disrespect_of_mothers_or_coparents: "Disrespect toward mothers or co-parents",
  unqualified_medical_or_legal_advice: "Medical or legal advice without a disclaimer",
  child_safety: "Children shown or discussed in an unsafe or exploitative way",
} as const;
export type RiskCategory = keyof typeof RISK_CATEGORIES;

export const REPORT_REASONS = {
  inappropriate: "Inappropriate or offensive",
  harassment_or_hate: "Harassment or hate",
  misinformation: "Misleading or false information",
  spam: "Spam or self-promotion",
  disrespectful_to_coparents: "Disrespectful to mothers or co-parents",
  child_safety: "A child's safety or privacy",
  other: "Something else",
} as const;
export type ReportReason = keyof typeof REPORT_REASONS;
