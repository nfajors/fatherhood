/**
 * The AI coach (development plan, Phase 3: "Advanced AI - personalized paths,
 * AI coaching companion"). Tuning lives here.
 */
export const COACH_POLICY = {
  model: "claude-opus-5-5",
  /**
   * Coaching is a conversation, not a hard reasoning task; medium keeps replies
   * thoughtful without long pauses. Raise only if measured quality calls for it.
   */
  effort: "medium",
  maxOutputTokens: 16_000,
  /** Library lookups per reply. */
  maxToolIterations: 4,
  /** Earlier messages sent with each turn (the rest stay in the database). */
  historyMessages: 24,
  /** Messages a member can send in any 24 hours. */
  dailyMessages: 40,
  maxMessageChars: 2_000,
  /** Characters of a lesson's transcript the coach may read at once. */
  maxTranscriptChars: 12_000,
  /** Results per library search. */
  searchResults: 8,
} as const;

export const COACH_STAGES = {
  considering: "Thinking about becoming a father",
  expecting: "Expecting a child",
  new_dad: "Father of a baby or toddler (0-2)",
  young_kids: "Father of young children (3-5)",
  school_age: "Father of school-age children (6-12)",
  teens: "Father of teenagers (13-18)",
  adult_kids: "Father of adult children",
} as const;

export type CoachStage = keyof typeof COACH_STAGES;
export const isCoachStage = (value: string): value is CoachStage => value in COACH_STAGES;

/** US resources, shown on every coach page and given by the coach when they're needed. */
export const CRISIS_RESOURCES = [
  { name: "Emergency", detail: "Call 911 if anyone is in immediate danger." },
  { name: "988 Suicide & Crisis Lifeline", detail: "Call or text 988, any time." },
  { name: "National Domestic Violence Hotline", detail: "1-800-799-7233, or text START to 88788." },
  { name: "Childhelp National Child Abuse Hotline", detail: "1-800-422-4453." },
] as const;
