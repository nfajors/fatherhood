import { describe, expect, it } from "vitest";
import { dueJobs, JOBS } from "./jobs.mjs";

const at = (iso: string) => dueJobs(new Date(iso)).map((j) => j.name);

describe("dueJobs", () => {
  it("runs each job on its schedule, by 5-minute slot", () => {
    expect(at("2026-11-21T10:00:30Z")).toEqual(["moderation", "email-sequences", "gift-delivery"]);
    expect(at("2026-11-21T10:05:00Z")).toEqual(["discussions"]);
    expect(at("2026-11-21T10:10:59Z")).toEqual(["moderation"]);
    expect(at("2026-11-21T10:15:00Z")).toEqual(["discussions", "email-sequences"]);
    expect(at("2026-11-21T10:30:00Z")).toEqual(["moderation", "email-sequences"]);
    // A tick that starts a little late still lands in its slot.
    expect(at("2026-11-21T10:39:59Z")).toEqual(["discussions"]);
    expect(at("2026-11-21T10:46:10Z")).toEqual(["discussions", "email-sequences"]);
  });

  it("runs payouts and organization access daily, and settlement early in the month", () => {
    expect(at("2026-11-21T06:00:00Z")).toContain("organizations");
    expect(at("2026-11-21T16:00:00Z")).toContain("payouts");
    expect(at("2026-11-21T16:05:00Z")).not.toContain("payouts");
    expect(at("2026-12-02T12:00:00Z")).toContain("revenue-settlement");
    expect(at("2026-12-04T12:00:00Z")).toContain("revenue-settlement");
    expect(at("2026-12-05T12:00:00Z")).not.toContain("revenue-settlement");
    expect(at("2026-12-01T12:00:00Z")).not.toContain("revenue-settlement");
  });

  it("covers every cron endpoint", () => {
    expect(JOBS.map((j) => j.path).sort()).toEqual(
      ["/api/cron/discussions", "/api/cron/email-sequences", "/api/cron/gift-delivery", "/api/cron/moderation", "/api/cron/organizations", "/api/cron/payouts", "/api/cron/revenue-settlement"].sort(),
    );
  });
});
