/**
 * Starting themes. PROVISIONAL: drawn from the book chapters and case studies
 * named in docs/development-plan.md, plus "Choosing a Partner"; replace with
 * themes taken from the Fatherhood in Focus draft once it is available.
 *
 * Seeding only inserts themes whose slug does not exist yet, so edits made by
 * admins are never overwritten. Descriptions are read by the classifier: say
 * what belongs in the theme and, where it helps, what does not.
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
      "Picking a mate and the mother of your future children: values, readiness, compatibility, family background, and how the choice of partner shapes a child's life. Before the children arrive.",
  },
  {
    slug: "why-fathers-matter",
    name: "Why Fathers Matter",
    description:
      "The evidence and argument for fathers: research on outcomes for children with engaged versus absent fathers, and what fathers uniquely contribute.",
    bookReference: "Why Fathers Matter",
  },
  {
    slug: "becoming-a-father",
    name: "Becoming a Father",
    description:
      "The transition into fatherhood: pregnancy, birth, the newborn months, identity change, and preparing yourself and your home.",
  },
  {
    slug: "presence",
    name: "Presence",
    description:
      "Being there in body and attention: time, routines, play, listening, and showing up consistently, including for fathers who travel or work long hours.",
  },
  {
    slug: "father-absence-and-repair",
    name: "Father Absence and Repair",
    description:
      "Growing up without a father, absent or estranged fathers, breaking the cycle, reconnecting with children, and healing your own father wound.",
  },
  {
    slug: "co-parenting",
    name: "Co-Parenting and Partnership",
    description:
      "Raising children with their mother, together or apart: teamwork, conflict, separation and divorce, blended families, and respect for co-parents.",
  },
  {
    slug: "discipline-and-character",
    name: "Discipline and Character",
    description:
      "Guiding behavior and forming character: boundaries, consequences, values, faith, responsibility, and teaching children to become good adults.",
  },
  {
    slug: "work-and-family",
    name: "Work and Family",
    description:
      "Providing and balancing: careers, money, time pressure, ambition, and the tradeoffs fathers make between work and home.",
  },
  {
    slug: "lessons-from-around-the-world",
    name: "Lessons from Around the World",
    description:
      "How fathers parent across cultures and societies, such as the Aka of Central Africa, and what those traditions teach modern fathers.",
    bookReference: "Lessons from Around the World",
  },
  {
    slug: "fathers-in-history",
    name: "Fathers in History",
    description:
      "Notable fathers and their legacies, such as Martin Luther King Sr. and Abraham Lincoln, and what their examples teach about fathering.",
    bookReference: "Case studies",
  },
];
