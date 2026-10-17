import { describe, expect, it } from "vitest";
import { canUpload, canWatch, hasActiveMembership, type PlayableVideo, type Viewer } from "./entitlements";

const NOW = new Date("2026-10-17T12:00:00Z");
const FUTURE = new Date("2026-11-17T12:00:00Z");
const PAST = new Date("2026-10-01T12:00:00Z");

const professional: PlayableVideo = { type: "professional", status: "approved", creatorId: "author" };
const community: PlayableVideo = { type: "community", status: "approved", creatorId: "fellow" };

const member: Viewer = { id: "m", role: "user", memberships: [{ status: "active", currentPeriodEnd: FUTURE }] };
const nonMember: Viewer = { id: "n", role: "user", memberships: [] };

describe("hasActiveMembership", () => {
  it.each(["active", "trialing", "past_due"] as const)("grants access while %s and unexpired", (status) => {
    expect(hasActiveMembership([{ status, currentPeriodEnd: FUTURE }], NOW)).toBe(true);
  });

  it.each(["canceled", "unpaid", "incomplete", "incomplete_expired", "paused"] as const)("denies %s", (status) => {
    expect(hasActiveMembership([{ status, currentPeriodEnd: FUTURE }], NOW)).toBe(false);
  });

  it("denies an active record whose period has ended", () => {
    expect(hasActiveMembership([{ status: "active", currentPeriodEnd: PAST }], NOW)).toBe(false);
  });

  it("grants access if any one record is current", () => {
    expect(
      hasActiveMembership(
        [
          { status: "canceled", currentPeriodEnd: PAST },
          { status: "active", currentPeriodEnd: FUTURE },
        ],
        NOW,
      ),
    ).toBe(true);
  });
});

describe("canWatch", () => {
  it("lets anyone, even signed out, watch approved Community videos unsigned", () => {
    expect(canWatch(community, null, { now: NOW })).toEqual({ allowed: true, signed: false });
  });

  it("requires sign-in for Professional videos", () => {
    expect(canWatch(professional, null, { now: NOW })).toEqual({ allowed: false, reason: "sign_in_required" });
  });

  it("requires a membership for Professional videos", () => {
    expect(canWatch(professional, nonMember, { now: NOW })).toEqual({ allowed: false, reason: "membership_required" });
  });

  it("lets members watch Professional videos with a signed token", () => {
    expect(canWatch(professional, member, { now: NOW })).toEqual({ allowed: true, signed: true });
  });

  it("opens preview lessons to everyone, still signed", () => {
    expect(canWatch(professional, null, { isPreviewLesson: true, now: NOW })).toEqual({ allowed: true, signed: true });
  });

  it("lets the creator and admins watch their own Professional video without a membership", () => {
    expect(canWatch(professional, { id: "author", role: "creator", memberships: [] })).toEqual({ allowed: true, signed: true });
    expect(canWatch(professional, { id: "x", role: "admin", memberships: [] })).toEqual({ allowed: true, signed: true });
  });

  it("hides unapproved videos from everyone but the creator and admins", () => {
    const pending: PlayableVideo = { ...community, status: "pending_review" };
    expect(canWatch(pending, null)).toEqual({ allowed: false, reason: "not_published" });
    expect(canWatch(pending, member)).toEqual({ allowed: false, reason: "not_published" });
    expect(canWatch(pending, { id: "fellow", role: "creator", memberships: [] })).toEqual({ allowed: true, signed: false });
    expect(canWatch(pending, { id: "a", role: "admin", memberships: [] })).toEqual({ allowed: true, signed: false });
  });

  it("does not let a preview flag expose an unapproved video", () => {
    const draft: PlayableVideo = { ...professional, status: "uploading" };
    expect(canWatch(draft, null, { isPreviewLesson: true })).toEqual({ allowed: false, reason: "not_published" });
  });
});

describe("canUpload", () => {
  it("allows Fellows to upload Community videos only", () => {
    expect(canUpload("creator", "community")).toBe(true);
    expect(canUpload("creator", "professional")).toBe(false);
  });

  it("allows admins to upload anything and plain users nothing", () => {
    expect(canUpload("admin", "professional")).toBe(true);
    expect(canUpload("admin", "community")).toBe(true);
    expect(canUpload("user", "community")).toBe(false);
  });
});
