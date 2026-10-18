/**
 * Email sequences (docs/development-plan.md Phase 2: email sequences). Each is
 * a list of steps sent a set time after someone is enrolled. Steps render from
 * a snapshot of the person's situation taken just before sending, so an email
 * never suggests a lesson they've already finished or a membership they
 * already have. A step that has nothing useful to say returns null and is
 * skipped. Who gets enrolled when is in engine.ts.
 */
import { PLANS, SITE } from "@/lib/config";
import type { EmailCategory } from "@/lib/db/schema";
import { formatMoney } from "@/lib/format";
import type { EmailContent, EmailItem } from "./template";

/** What a sequence email can draw on, loaded for one person (context.ts). */
export type EmailContext = {
  firstName: string;
  member: boolean;
  /** When access ended, for people who were members. */
  membershipEndedAt: Date | null;
  lastActiveAt: Date | null;
  /** The most recent lesson or video they started and haven't finished. */
  continueItem: { title: string; href: string; context: string } | null;
  lessonsCompleted: number;
  certificates: number;
  /** The first featured collection, e.g. "Start Here". */
  startHere: { title: string; href: string } | null;
  /** A free preview lesson from the newest course that has one. */
  freeLesson: { title: string; courseTitle: string; href: string } | null;
  /** Published courses, newest first. */
  courses: (EmailItem & { publishedAt: Date | null })[];
  /** Community Voices picks for this person (or popular ones). */
  stories: EmailItem[];
};

export type SequenceStep = {
  id: string;
  /** Hours after enrollment. */
  delayHours: number;
  render(ctx: EmailContext): EmailContent | null;
};

export type SequenceId = "welcome" | "member_onboarding" | "reengagement" | "winback";

export type Sequence = {
  id: SequenceId;
  name: string;
  /** Who it's for, for the admin page. */
  audience: string;
  category: EmailCategory;
  steps: SequenceStep[];
  /** Why the person should leave the sequence now, or null to carry on. */
  exitReason(ctx: EmailContext, enrolledAt: Date): string | null;
};

const price = `${formatMoney(PLANS.monthly.amountCents)} a month or ${formatMoney(PLANS.annual.amountCents)} a year`;

function startItems(ctx: EmailContext): EmailItem[] {
  const items: EmailItem[] = [];
  if (ctx.freeLesson) {
    items.push({ title: ctx.freeLesson.title, href: ctx.freeLesson.href, meta: `Free lesson from ${ctx.freeLesson.courseTitle}` });
  }
  if (ctx.startHere) {
    items.push({ title: ctx.startHere.title, href: ctx.startHere.href, meta: "A short path through the best of the site" });
  }
  items.push({ title: "Community Voices", href: "/community", meta: "Short, free videos from fathers like you" });
  return items;
}

const welcome: Sequence = {
  id: "welcome",
  name: "Welcome",
  audience: "New accounts without a membership. Ends if they join.",
  category: "learning",
  exitReason: (ctx) => (ctx.member ? "became_member" : null),
  steps: [
    {
      id: "start",
      delayHours: 0,
      render: (ctx) => ({
        subject: `Welcome to ${SITE.name}`,
        preheader: "Three good places to start, all free.",
        heading: `Welcome, ${ctx.firstName}.`,
        blocks: [
          {
            kind: "p",
            text: `${SITE.name} is where fathers, and men who will become fathers, get better at the job that matters most. It's the companion academy to the book ${SITE.bookTitle}.`,
          },
          { kind: "p", text: "You don't need a membership to begin. Here are three good places to start:" },
          { kind: "items", items: startItems(ctx) },
          ctx.freeLesson ? { kind: "button", label: "Watch the free lesson", href: ctx.freeLesson.href } : { kind: "button", label: "Browse the Academy", href: "/academy" },
        ],
      }),
    },
    {
      id: "stories",
      delayHours: 48,
      render: (ctx) =>
        ctx.stories.length === 0
          ? null
          : {
              subject: "Short stories from other fathers",
              preheader: "Free, and most take less than eight minutes.",
              heading: "You're not the only one figuring this out",
              blocks: [
                {
                  kind: "p",
                  text: "Community Voices are short videos from fathers: what worked, what didn't, and what they wish someone had told them. They're free, and most take less than eight minutes.",
                },
                { kind: "items", items: ctx.stories },
                { kind: "button", label: "See more Community Voices", href: "/community" },
              ],
            },
    },
    {
      id: "membership",
      delayHours: 120,
      render: (ctx) =>
        ctx.courses.length === 0
          ? null
          : {
              subject: "What's inside the Academy",
              preheader: `Every course, new ones each month, for ${price}.`,
              heading: "What membership gets you",
              blocks: [
                {
                  kind: "p",
                  text: `The Academy is a library of structured courses: short lessons you can watch in a spare ten minutes, with workbooks, quizzes and a certificate when you finish.`,
                },
                { kind: "items", items: ctx.courses.slice(0, 3) },
                { kind: "p", text: `Membership is ${price}, and includes every course, with new ones each month. Cancel any time.` },
                { kind: "button", label: "See membership", href: "/pricing" },
                ctx.freeLesson
                  ? { kind: "small", text: `Not sure yet? "${ctx.freeLesson.title}" is free to watch.` }
                  : { kind: "small", text: "Community Voices stay free whether you join or not." },
              ],
            },
    },
  ],
};

const memberOnboarding: Sequence = {
  id: "member_onboarding",
  name: "New member",
  audience: "Members in their first days. Ends if the membership does.",
  category: "learning",
  exitReason: (ctx) => (ctx.member ? null : "membership_ended"),
  steps: [
    {
      id: "start",
      delayHours: 0,
      render: (ctx) => {
        const first = ctx.continueItem ?? (ctx.courses[0] ? { title: ctx.courses[0].title, href: ctx.courses[0].href } : null);
        return {
          subject: "Your membership is active",
          preheader: "Where to begin, and how to get the most from it.",
          heading: `You're in, ${ctx.firstName}.`,
          blocks: [
            { kind: "p", text: `Thank you for joining. Every course in the Academy is now open to you.` },
            {
              kind: "p",
              text: "A few things that help: lessons are short, so one a day adds up fast. Most lessons have a workbook or reflection card to download. Some end with a short quiz, and finishing a course earns a certificate you can share.",
            },
            ...(ctx.courses.length ? [{ kind: "items" as const, items: ctx.courses.slice(0, 3) }] : []),
            first
              ? { kind: "button", label: ctx.continueItem ? `Continue "${first.title}"` : `Start "${first.title}"`, href: first.href }
              : { kind: "button", label: "Browse the Academy", href: "/academy" },
          ],
        };
      },
    },
    {
      id: "first-week",
      delayHours: 72,
      render: (ctx) => {
        if (ctx.continueItem) {
          return {
            subject: `Pick up "${ctx.continueItem.title}"`,
            preheader: "You're partway through. Ten minutes finishes it.",
            heading: "You've made a start",
            blocks: [
              { kind: "p", text: `You're partway through "${ctx.continueItem.title}" (${ctx.continueItem.context}). The next ten minutes are a good place to finish it.` },
              { kind: "button", label: "Continue watching", href: ctx.continueItem.href },
            ],
          };
        }
        if (ctx.lessonsCompleted > 0) {
          return {
            subject: "Your next lesson",
            preheader: "Keep the momentum going.",
            heading: `${ctx.lessonsCompleted} ${ctx.lessonsCompleted === 1 ? "lesson" : "lessons"} done`,
            blocks: [
              { kind: "p", text: "Good start. Here's what to watch next:" },
              { kind: "items", items: ctx.courses.slice(0, 3) },
              { kind: "button", label: "Go to My Learning", href: "/learning" },
            ],
          };
        }
        const course = ctx.courses[0];
        return {
          subject: "Ten minutes is enough to start",
          preheader: "The first lesson is short.",
          heading: "The hardest part is the first lesson",
          blocks: [
            {
              kind: "p",
              text: "Life with kids is busy, and a new course can feel like one more thing. It doesn't need to be: most lessons are under fifteen minutes, and you can watch on your phone.",
            },
            course
              ? { kind: "button", label: `Start "${course.title}"`, href: course.href }
              : { kind: "button", label: "Browse the Academy", href: "/academy" },
          ],
        };
      },
    },
    {
      id: "beyond-courses",
      delayHours: 240,
      render: (ctx) => ({
        subject: "More than courses",
        preheader: "Certificates, Community Voices and picks for you.",
        heading: "A few things you may have missed",
        blocks: [
          {
            kind: "p",
            text:
              ctx.certificates > 0
                ? `You've already earned ${ctx.certificates === 1 ? "a certificate" : `${ctx.certificates} certificates`}. Well done. You can share them or add them to LinkedIn from My Learning.`
                : "Finish every lesson in a course (and pass its quizzes) and you earn a certificate you can share or add to LinkedIn.",
          },
          ...(ctx.stories.length
            ? [
                { kind: "p" as const, text: "Community Voices are short videos from other fathers. A few we think you'll like:" },
                { kind: "items" as const, items: ctx.stories },
              ]
            : []),
          { kind: "button", label: "Go to My Learning", href: "/learning" },
        ],
      }),
    },
  ],
};

const reengagement: Sequence = {
  id: "reengagement",
  name: "Come back",
  audience: "Members who haven't watched anything in two weeks. At most once a month.",
  category: "learning",
  exitReason: (ctx, enrolledAt) => {
    if (!ctx.member) return "membership_ended";
    if (ctx.lastActiveAt && ctx.lastActiveAt > enrolledAt) return "active_again";
    return null;
  },
  steps: [
    {
      id: "nudge",
      delayHours: 0,
      render: (ctx) => {
        const fresh = ctx.courses.filter((c) => c.publishedAt && ctx.lastActiveAt && c.publishedAt > ctx.lastActiveAt);
        if (ctx.continueItem) {
          return {
            subject: `Still thinking about "${ctx.continueItem.title}"?`,
            preheader: "Pick up right where you left off.",
            heading: "Pick up where you left off",
            blocks: [
              { kind: "p", text: `It's been a little while. You were partway through "${ctx.continueItem.title}" (${ctx.continueItem.context}), and it'll start right where you stopped.` },
              { kind: "button", label: "Continue watching", href: ctx.continueItem.href },
              ...(fresh.length ? [{ kind: "p" as const, text: "New since you were last here:" }, { kind: "items" as const, items: fresh.slice(0, 3) }] : []),
            ],
          };
        }
        const picks = fresh.length ? fresh : ctx.courses;
        if (picks.length === 0 && ctx.stories.length === 0) return null;
        return {
          subject: fresh.length ? "New in the Academy" : "Something good to watch this week",
          preheader: "Ten minutes, whenever suits you.",
          heading: fresh.length ? "New since you were last here" : "Something good to watch this week",
          blocks: [
            { kind: "p", text: "Your membership includes everything below. A lesson takes about ten minutes." },
            ...(picks.length ? [{ kind: "items" as const, items: picks.slice(0, 3) }] : []),
            ...(ctx.stories.length ? [{ kind: "p" as const, text: "And from Community Voices:" }, { kind: "items" as const, items: ctx.stories.slice(0, 2) }] : []),
            { kind: "button", label: "Go to My Learning", href: "/learning" },
          ],
        };
      },
    },
  ],
};

const winback: Sequence = {
  id: "winback",
  name: "Win-back",
  audience: "People whose membership ended in the last month. Ends if they rejoin.",
  category: "announcements",
  exitReason: (ctx) => (ctx.member ? "rejoined" : null),
  steps: [
    {
      id: "ended",
      delayHours: 0,
      render: (ctx) => ({
        subject: `Your ${SITE.name} membership has ended`,
        preheader: "Your progress is saved if you come back.",
        heading: `Thanks for being a member, ${ctx.firstName}`,
        blocks: [
          {
            kind: "p",
            text:
              ctx.lessonsCompleted > 0
                ? `You finished ${ctx.lessonsCompleted} ${ctx.lessonsCompleted === 1 ? "lesson" : "lessons"}${ctx.certificates ? ` and earned ${ctx.certificates === 1 ? "a certificate" : `${ctx.certificates} certificates`}` : ""}. Your progress and certificates are saved.`
                : "Your account and progress are saved.",
          },
          ...(ctx.continueItem
            ? [{ kind: "p" as const, text: `If you rejoin, "${ctx.continueItem.title}" will start right where you left off.` }]
            : []),
          { kind: "p", text: "Community Voices stay free, and free preview lessons stay open, whenever you want them." },
          { kind: "button", label: "Rejoin", href: "/pricing" },
          { kind: "small", text: "If something didn't work for you, reply to this email and tell us." },
        ],
      }),
    },
    {
      id: "whats-new",
      delayHours: 24 * 30,
      render: (ctx) => {
        const fresh = ctx.courses.filter((c) => c.publishedAt && ctx.membershipEndedAt && c.publishedAt > ctx.membershipEndedAt);
        if (fresh.length === 0) return null;
        return {
          subject: `New at ${SITE.name} since you left`,
          preheader: fresh.map((c) => c.title).join(", "),
          heading: "New since you left",
          blocks: [
            { kind: "p", text: `We've added ${fresh.length === 1 ? "a new course" : `${fresh.length} new courses`} since your membership ended:` },
            { kind: "items", items: fresh.slice(0, 3) },
            { kind: "button", label: "Rejoin", href: "/pricing" },
          ],
        };
      },
    },
  ],
};

export const SEQUENCES: Record<SequenceId, Sequence> = {
  welcome,
  member_onboarding: memberOnboarding,
  reengagement,
  winback,
};

export const SEQUENCE_IDS = Object.keys(SEQUENCES) as SequenceId[];

/** A made-up person for admin previews and tests. */
export function sampleContext(overrides: Partial<EmailContext> = {}): EmailContext {
  const course = (title: string, slug: string, meta: string, publishedAt: string) => ({ title, href: `/academy/${slug}`, meta, publishedAt: new Date(publishedAt) });
  return {
    firstName: "Sam",
    member: false,
    membershipEndedAt: null,
    lastActiveAt: null,
    continueItem: null,
    lessonsCompleted: 0,
    certificates: 0,
    startHere: { title: "Start Here", href: "/collections/start-here" },
    freeLesson: { title: "Why your presence matters", courseTitle: "Present Fathers", href: "/academy/present-fathers/sample" },
    courses: [
      course("Present Fathers", "present-fathers", "3 lessons · 30 min", "2026-10-01T00:00:00Z"),
      course("Why Fathers Matter", "why-fathers-matter", "6 lessons · 1 hr 10 min", "2026-09-01T00:00:00Z"),
    ],
    stories: [
      { title: "The apology that changed bedtime", href: "/community/sample-1", meta: "Marcus R. · 6 min" },
      { title: "Bedtime stories that stuck", href: "/community/sample-2", meta: "James O. · 4 min" },
    ],
    ...overrides,
  };
}
