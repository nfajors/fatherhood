import { describe, expect, it } from "vitest";
import { previewContext } from "./admin";
import { SEQUENCE_IDS, SEQUENCES, sampleContext } from "./sequences";

const step = (seq: keyof typeof SEQUENCES, id: string) => SEQUENCES[seq].steps.find((s) => s.id === id)!;
const texts = (c: ReturnType<ReturnType<typeof step>["render"]>) => JSON.stringify(c);

describe("sequences", () => {
  it("every step renders for both sample people, with steps in time order", () => {
    for (const id of SEQUENCE_IDS) {
      const steps = SEQUENCES[id].steps;
      expect(steps.map((s) => s.delayHours)).toEqual([...steps.map((s) => s.delayHours)].sort((a, b) => a - b));
      expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
      for (const variant of ["new", "progress"] as const) {
        for (const s of steps) expect(() => s.render(previewContext(id, variant))).not.toThrow();
      }
    }
  });

  it("knows when to stop", () => {
    const enrolled = new Date("2026-10-01T00:00:00Z");
    expect(SEQUENCES.welcome.exitReason(sampleContext({ member: true }), enrolled)).toBe("became_member");
    expect(SEQUENCES.welcome.exitReason(sampleContext(), enrolled)).toBeNull();
    expect(SEQUENCES.member_onboarding.exitReason(sampleContext({ member: false }), enrolled)).toBe("membership_ended");
    expect(SEQUENCES.reengagement.exitReason(sampleContext({ member: true, lastActiveAt: new Date("2026-10-02T00:00:00Z") }), enrolled)).toBe("active_again");
    expect(SEQUENCES.reengagement.exitReason(sampleContext({ member: true, lastActiveAt: new Date("2026-09-01T00:00:00Z") }), enrolled)).toBeNull();
    expect(SEQUENCES.winback.exitReason(sampleContext({ member: true }), enrolled)).toBe("rejoined");
  });

  it("welcome points at the free lesson, and skips steps with nothing to show", () => {
    const start = step("welcome", "start").render(sampleContext())!;
    expect(start.subject).toBe("Welcome to Fatherhood.School");
    expect(start.heading).toBe("Welcome, Sam.");
    expect(texts(start)).toContain("/academy/present-fathers/sample");
    expect(step("welcome", "start").render(sampleContext({ freeLesson: null, startHere: null }))!.blocks.at(-1)).toEqual({
      kind: "button",
      label: "Browse the Academy",
      href: "/academy",
    });
    expect(step("welcome", "stories").render(sampleContext({ stories: [] }))).toBeNull();
    expect(step("welcome", "membership").render(sampleContext({ courses: [] }))).toBeNull();
    expect(texts(step("welcome", "membership").render(sampleContext()))).toContain("$19.00 a month or $199.00 a year");
  });

  it("the first-week nudge depends on what they've done", () => {
    const first = step("member_onboarding", "first-week");
    const resume = { title: "Showing up every day", href: "/academy/p/2", context: "Present Fathers" };
    expect(first.render(sampleContext({ member: true, continueItem: resume }))!.subject).toBe('Pick up "Showing up every day"');
    expect(first.render(sampleContext({ member: true, lessonsCompleted: 2 }))!.heading).toBe("2 lessons done");
    expect(first.render(sampleContext({ member: true }))!.subject).toBe("Ten minutes is enough to start");
  });

  it("re-engagement leads with unfinished work, then what's new since they were last active", () => {
    const nudge = step("reengagement", "nudge");
    const lastActiveAt = new Date("2026-09-15T00:00:00Z");
    const withNew = nudge.render(sampleContext({ member: true, lastActiveAt }))!;
    expect(withNew.subject).toBe("New in the Academy");
    // Only Present Fathers (published Oct 1) is newer than the last visit.
    expect(texts(withNew)).toContain("Present Fathers");
    expect(texts(withNew)).not.toContain("Why Fathers Matter");
    expect(nudge.render(sampleContext({ member: true, lastActiveAt: new Date("2026-10-10T00:00:00Z") }))!.subject).toBe("Something good to watch this week");
    expect(nudge.render(sampleContext({ member: true, courses: [], stories: [] }))).toBeNull();
  });

  it("win-back only follows up when there's something new", () => {
    const later = step("winback", "whats-new");
    expect(later.render(sampleContext({ membershipEndedAt: new Date("2026-10-15T00:00:00Z") }))).toBeNull();
    const news = later.render(sampleContext({ membershipEndedAt: new Date("2026-09-15T00:00:00Z") }))!;
    expect(news.blocks[0]).toEqual({ kind: "p", text: "We've added a new course since your membership ended:" });
    expect(texts(step("winback", "ended").render(sampleContext({ lessonsCompleted: 4, certificates: 1 })))).toContain(
      "You finished 4 lessons and earned a certificate.",
    );
  });
});
