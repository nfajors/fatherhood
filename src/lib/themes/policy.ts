/** Tuning for the theme classifier. */
export const THEME_POLICY = {
  /** Most themes a piece of content is placed in. */
  maxThemesPerItem: 3,
  /** Placements below this confidence (0-100) are dropped. */
  minConfidence: 55,
  /**
   * A new theme is only proposed when no existing theme fits at least this well,
   * so the catalog grows for genuinely new topics, not near-misses.
   */
  strongFitConfidence: 75,
  /** Transcript characters sent to the classifier (title and description always go in full). */
  maxTranscriptChars: 6_000,
  model: "claude-opus-5-5",
} as const;
