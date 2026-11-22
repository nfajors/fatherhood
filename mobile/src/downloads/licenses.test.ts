import { describe, expect, it } from "vitest";
import { applyChecks, CHECK_EVERY_MS, daysLeft, isPlayable, needsCheck, type DownloadRecord } from "./licenses";

const NOW = new Date("2026-11-22T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const record = (videoId: string, expiresInDays: number, checkedAgoMs = 0): DownloadRecord => ({
  videoId,
  title: videoId,
  context: "Presence",
  durationSeconds: 600,
  target: { kind: "community", videoId },
  fileName: `${videoId}.mp4`,
  sizeBytes: 1000,
  licenseExpiresAt: new Date(NOW.getTime() + expiresInDays * DAY).toISOString(),
  downloadedAt: NOW.toISOString(),
  lastCheckedAt: new Date(NOW.getTime() - checkedAgoMs).toISOString(),
});

describe("offline licenses", () => {
  it("plays until the license runs out", () => {
    expect(isPlayable(record("a", 1), NOW)).toBe(true);
    expect(isPlayable(record("a", -0.01), NOW)).toBe(false);
    expect(daysLeft(record("a", 29.5), NOW)).toBe(29);
    expect(daysLeft(record("a", -3), NOW)).toBe(0);
  });

  it("checks in every few hours", () => {
    expect(needsCheck([record("a", 20, 1000)], NOW)).toBe(false);
    expect(needsCheck([record("a", 20, 1000), record("b", 20, CHECK_EVERY_MS)], NOW)).toBe(true);
  });

  it("offline: removes only what has run out", () => {
    const { keep, remove } = applyChecks([record("a", 5), record("b", -1)], null, NOW);
    expect(keep.map((r) => r.videoId)).toEqual(["a"]);
    expect(remove.map((r) => r.videoId)).toEqual(["b"]);
  });

  it("online: renews valid licenses, removes revoked ones, leaves unanswered ones as they are", () => {
    const renewed = new Date(NOW.getTime() + 30 * DAY).toISOString();
    const { keep, remove } = applyChecks(
      [record("a", 2, CHECK_EVERY_MS), record("b", 10), record("c", 3), record("d", -1)],
      [
        { videoId: "a", status: "valid", licenseExpiresAt: renewed },
        { videoId: "b", status: "revoked" },
        { videoId: "d", status: "valid", licenseExpiresAt: renewed },
      ],
      NOW,
    );
    expect(keep.map((r) => [r.videoId, r.licenseExpiresAt, r.lastCheckedAt])).toEqual([
      ["a", renewed, NOW.toISOString()],
      ["c", record("c", 3).licenseExpiresAt, NOW.toISOString()],
      ["d", renewed, NOW.toISOString()],
    ]);
    expect(remove.map((r) => r.videoId)).toEqual(["b"]);
  });
});
