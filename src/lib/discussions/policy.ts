/**
 * Discussions (development plan, Phase 3: "Full social features"): members' posts
 * and replies in a main feed and in topic groups our team creates, follows, and a
 * "me too" reaction. No private messages. Tuning lives here.
 */
export const DISCUSSION_POLICY = {
  minChars: 2,
  maxPostChars: 3_000,
  maxReplyChars: 2_000,
  /** Posts and replies together, per person. */
  rateLimit: { count: 6, windowMinutes: 10 },
  pageSize: 20,
  /** The AI check before a post appears. Low effort: it should take a second or two. */
  screen: { model: "claude-opus-5-5", effort: "low", maxAttempts: 5 },
} as const;

/** What the AI check holds for a moderator. Everything else appears at once. */
export const POST_RISKS = {
  harassment_or_hate: "Attacks, insults, slurs or harassment aimed at a person or group",
  threats_or_violence: "Threats, or encouraging violence",
  sexual: "Sexual content",
  self_harm: "The writer or someone else may be at risk of suicide or self-harm",
  child_safety: "A child at risk, or details that identify a child (full name with school, address or photos)",
  personal_information: "Someone's contact details or address, or naming an ex or co-parent in full",
  spam_or_scam: "Ads, links to sell something, scams",
  dangerous_or_illegal: "Help with dangerous or illegal acts, including getting around custody or protective orders",
} as const;
export type PostRisk = keyof typeof POST_RISKS;

/** The groups offered by "Add starter groups"; admins can edit or archive them. */
export const STARTER_GROUPS = [
  { slug: "expecting", name: "Expecting", description: "Getting ready for your first, or your next." },
  { slug: "new-dads", name: "New dads", description: "Babies and toddlers: sleep, feeding, and finding your feet." },
  { slug: "school-age", name: "School-age kids", description: "Homework, sports, friendships and the years in between." },
  { slug: "teens", name: "Dads of teens", description: "Staying close while they grow up and pull away." },
  { slug: "co-parenting", name: "Co-parenting", description: "Raising kids across two homes, with respect for everyone in it." },
  { slug: "military", name: "Military dads", description: "Deployments, moves and staying connected from far away." },
  { slug: "faith", name: "Faith and fatherhood", description: "Raising children in your faith." },
  { slug: "grieving", name: "Grieving fathers", description: "For fathers who have lost a child, a partner or their own dad." },
] as const;
