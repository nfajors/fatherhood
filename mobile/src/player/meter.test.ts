import { describe, expect, it } from "vitest";
import { WatchMeter } from "./meter";
import { afterSync, isFinished, queueProgress, resumeAt } from "./progressQueue";

describe("WatchMeter", () => {
  it("counts continuous playback, not pauses or seeks, and carries fractions over", () => {
    const m = new WatchMeter();
    m.tick(10, true); // first update only sets the start
    m.tick(11, true);
    m.tick(12.5, true);
    m.tick(13.5, false); // paused
    m.tick(120, true); // seeked ahead
    m.tick(121, true);
    expect(m.take()).toBe(3); // 1 + 1.5 + 1 = 3.5
    m.tick(121.6, true);
    expect(m.take()).toBe(1); // 0.5 carried + 0.6
    expect(m.take()).toBe(0);
  });
});

describe("offline progress queue", () => {
  const at = (s: number) => new Date(Date.UTC(2026, 10, 22, 12, 0, s)).toISOString();

  it("keeps one record per video, the latest, and completion sticks", () => {
    let q = queueProgress([], { videoId: "a", positionSeconds: 10, completed: false, recordedAt: at(1) });
    q = queueProgress(q, { videoId: "b", positionSeconds: 5, completed: false, recordedAt: at(2) });
    q = queueProgress(q, { videoId: "a", positionSeconds: 600, completed: true, recordedAt: at(3) });
    q = queueProgress(q, { videoId: "a", positionSeconds: 20, completed: false, recordedAt: at(4) });
    expect(q).toEqual([
      { videoId: "b", positionSeconds: 5, completed: false, recordedAt: at(2) },
      { videoId: "a", positionSeconds: 20, completed: true, recordedAt: at(4) },
    ]);
  });

  it("after a sync, keeps only what was queued again meanwhile", () => {
    const sent = [{ videoId: "a", positionSeconds: 10, completed: false, recordedAt: at(1) }];
    const now = [...sent, { videoId: "b", positionSeconds: 3, completed: false, recordedAt: at(2) }];
    expect(afterSync(now, sent).map((q) => q.videoId)).toEqual(["b"]);
    const requeued = queueProgress(now, { videoId: "a", positionSeconds: 40, completed: false, recordedAt: at(5) });
    expect(afterSync(requeued, sent).map((q) => q.videoId).sort()).toEqual(["a", "b"]);
  });

  it("finishes near the end and resumes a little before his place", () => {
    expect(isFinished(540, 600)).toBe(true);
    expect(isFinished(100, 600)).toBe(false);
    expect(isFinished(100, null)).toBe(false);
    expect(resumeAt(100, 600, false)).toBe(97);
    expect(resumeAt(595, 600, false)).toBe(0);
    expect(resumeAt(100, 600, true)).toBe(0);
  });
});
