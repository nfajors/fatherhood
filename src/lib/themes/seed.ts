/**
 * Starting themes, taken from the draft of Fatherhood in Focus (revised July
 * 2026). Each theme cites the chapters it comes from.
 *
 * Seeding inserts themes whose slug does not exist yet, and upgrades rows that
 * still exactly match an earlier version of a seed theme (SUPERSEDED_SEED_THEMES),
 * so a theme an admin has edited is never overwritten. Descriptions are read by
 * the classifier: say what belongs in the theme and, where themes neighbor each
 * other, what does not.
 */
export type SeedTheme = {
  slug: string;
  name: string;
  description: string;
  bookReference?: string;
};

export const SEED_THEMES: SeedTheme[] = [
  {
    slug: "choosing-a-partner",
    name: "Choosing a Partner",
    description:
      "Picking a mate before children arrive: knowing what kind of parent your partner will be, understanding her family dynamics, shared values, and commitment as a covenant rather than a contract. The decision fathers call their most consequential. Life with an existing partner belongs in Partnership and Co-Parenting.",
    bookReference: "Ch. 6, Finding Two: The Most Consequential Parenting Decision Is Made Before the Child Exists",
  },
  {
    slug: "partnership-and-co-parenting",
    name: "Partnership and Co-Parenting",
    description:
      "The relationship with your children's mother once they are here: loving and supporting her, sharing the load, resolving disagreements in front of the kids, maternal gatekeeping, and protecting children's stability through separation, divorce and shared custody.",
    bookReference: "Ch. 8, Invest in Your Partnership; Ch. 10, Your Partnership Matters",
  },
  {
    slug: "becoming-a-father",
    name: "Becoming a Father",
    description:
      "The transition into fatherhood: pregnancy, the birth, the newborn months, fear of not being ready, learning hands-on skills, and new-dad support such as Boot Camp for New Dads. Fatherhood is learned, not innate.",
    bookReference: "Prologue; Ch. 6 and 8, Boot Camp for New Dads",
  },
  {
    slug: "presence",
    name: "Presence",
    description:
      "Being there in body and attention: everyday time, the small moments rather than only the big events, putting the phone away, and the near-universal regret of time lost to work and distraction. Presence over perfection.",
    bookReference: "Ch. 6, Finding Three; Ch. 8, Prioritize Presence; Ch. 10, Presence Over Perfection",
  },
  {
    slug: "grow-the-tree-you-have",
    name: "Grow the Tree You Have",
    description:
      "Accepting and getting to know the child you actually have: each child is different, letting go of rigid expectations and the 'perfect child' model, and raising children with special or neurodivergent needs.",
    bookReference: "Ch. 6, Finding Four; Ch. 10, Each Child Is Different; Epilogue",
  },
  {
    slug: "values-and-character",
    name: "Values and Character",
    description:
      "Raising good adults: passing on core values rather than a script, chores and responsibility, discipline and boundaries, not spoiling, faith, and modeling what you want to see, because your children are watching.",
    bookReference: "Ch. 6, Finding Seven; Ch. 8, Be Intentional About Teaching; Ch. 10, Model What You Want to See",
  },
  {
    slug: "the-biology-of-fatherhood",
    name: "The Biology of Fatherhood",
    description:
      "How fatherhood changes men: the 'dad brain', hormonal shifts, the evolution of human fathering, and what primates such as marmosets and tamarins reveal. Fathers are biologically equipped for parenthood.",
    bookReference: "Ch. 3, The Foundations of Fatherhood",
  },
  {
    slug: "why-fathers-matter",
    name: "Why Fathers Matter",
    description:
      "The research evidence on what fathers contribute to children's outcomes in school, behavior and opportunity (Fragile Families, the Opportunity Atlas, fatherhood programs), and the debates and critiques around that evidence.",
    bookReference: "Ch. 4, Why Fathers Matter; Ch. 5, The Critics and the Controversies",
  },
  {
    slug: "breaking-the-cycle",
    name: "Breaking the Cycle",
    description:
      "Father absence and the way back: growing up without a father, healing the father wound, absent or estranged fathers reconnecting with their children, and becoming the father you didn't have. Personal journeys of repair and redemption.",
    bookReference: "Ch. 2, The Invisible Crisis; Ch. 6, James Tidwell's Journey; Ch. 10, Barack Obama and Bruce Springsteen",
  },
  {
    slug: "work-and-family",
    name: "Work and Family",
    description:
      "Careers, money and time at home: the myth of father as provider only, travel and long hours, paternity leave, remote and flexible work, and building father-friendly workplaces.",
    bookReference: "Ch. 8, In Your Workplace; Ch. 9, The Remote Work Revolution",
  },
  {
    slug: "lessons-from-around-the-world",
    name: "Lessons from Around the World",
    description:
      "How fathering differs across cultures and countries, from the Aka of Central Africa to Japan's ikumen, Nordic and Portuguese paternity leave, France, Brazil and Ethiopia, and what each teaches fathers everywhere.",
    bookReference: "Ch. 1, The World's Best Dads; Ch. 7, Lessons from Around the World",
  },
  {
    slug: "fathers-in-history",
    name: "Fathers in History",
    description:
      "Notable fathers and the legacies they left, such as Martin Luther King Sr. and Abraham Lincoln, how the role of the father has changed since the Roman pater familias, and the legacy you will leave.",
    bookReference: "Ch. 1, Voices of Fatherhood; Ch. 3, Pater Familias",
  },
  {
    slug: "the-future-of-fatherhood",
    name: "The Future of Fatherhood",
    description:
      "Raising children for a changing world and the new generation of dads: social media and technology, artificial intelligence, affordability, changing gender norms, gentle parenting and the mental load.",
    bookReference: "Ch. 6, Finding Six: What They Fear; Ch. 9, The Future of Fatherhood",
  },
];

/**
 * Earlier seed versions. A row still matching one exactly (slug, name and
 * description) was never edited by an admin, so seeding upgrades it in place to
 * the theme named by `replacedBy`, keeping its placements.
 */
export const SUPERSEDED_SEED_THEMES: { slug: string; name: string; description: string; replacedBy: string }[] = [
  {
    slug: "choosing-a-partner",
    name: "Choosing a Partner",
    description:
      "Picking a mate and the mother of your future children: values, readiness, compatibility, family background, and how the choice of partner shapes a child's life. Before the children arrive.",
    replacedBy: "choosing-a-partner",
  },
  {
    slug: "why-fathers-matter",
    name: "Why Fathers Matter",
    description:
      "The evidence and argument for fathers: research on outcomes for children with engaged versus absent fathers, and what fathers uniquely contribute.",
    replacedBy: "why-fathers-matter",
  },
  {
    slug: "becoming-a-father",
    name: "Becoming a Father",
    description:
      "The transition into fatherhood: pregnancy, birth, the newborn months, identity change, and preparing yourself and your home.",
    replacedBy: "becoming-a-father",
  },
  {
    slug: "presence",
    name: "Presence",
    description:
      "Being there in body and attention: time, routines, play, listening, and showing up consistently, including for fathers who travel or work long hours.",
    replacedBy: "presence",
  },
  {
    slug: "father-absence-and-repair",
    name: "Father Absence and Repair",
    description:
      "Growing up without a father, absent or estranged fathers, breaking the cycle, reconnecting with children, and healing your own father wound.",
    replacedBy: "breaking-the-cycle",
  },
  {
    slug: "co-parenting",
    name: "Co-Parenting and Partnership",
    description:
      "Raising children with their mother, together or apart: teamwork, conflict, separation and divorce, blended families, and respect for co-parents.",
    replacedBy: "partnership-and-co-parenting",
  },
  {
    slug: "discipline-and-character",
    name: "Discipline and Character",
    description:
      "Guiding behavior and forming character: boundaries, consequences, values, faith, responsibility, and teaching children to become good adults.",
    replacedBy: "values-and-character",
  },
  {
    slug: "work-and-family",
    name: "Work and Family",
    description:
      "Providing and balancing: careers, money, time pressure, ambition, and the tradeoffs fathers make between work and home.",
    replacedBy: "work-and-family",
  },
  {
    slug: "lessons-from-around-the-world",
    name: "Lessons from Around the World",
    description:
      "How fathers parent across cultures and societies, such as the Aka of Central Africa, and what those traditions teach modern fathers.",
    replacedBy: "lessons-from-around-the-world",
  },
  {
    slug: "fathers-in-history",
    name: "Fathers in History",
    description:
      "Notable fathers and their legacies, such as Martin Luther King Sr. and Abraham Lincoln, and what their examples teach about fathering.",
    replacedBy: "fathers-in-history",
  },
];
