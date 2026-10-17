"use client";

import { Stream, type StreamPlayerApi } from "@cloudflare/stream-react";
import { useCallback, useEffect, useRef } from "react";

const HEARTBEAT_MS = 15_000;

export type VideoPlayerProps = {
  videoId: string;
  /** Stream uid, or a signed token for members-only videos. */
  src: string;
  customerCode: string;
  title: string;
  poster?: string | null;
  /** Resume position in seconds. */
  startAt?: number;
  onCompleted?: () => void;
};

/** Seconds actually played: running since `playingSince`, plus time banked but not yet reported. */
type Clock = { playingSince: number | null; unreported: number };

/** Bank the time played since the last check. */
function tally(clock: Clock) {
  if (clock.playingSince === null) return;
  const now = Date.now();
  clock.unreported += (now - clock.playingSince) / 1000;
  clock.playingSince = now;
}

/** Stop the clock on pause or end, keeping the time for the next report. */
function stopClock(clock: Clock) {
  tally(clock);
  clock.playingSince = null;
}

/** Take the unreported time for a heartbeat. */
function takeWatched(clock: Clock) {
  tally(clock);
  const watched = clock.unreported;
  clock.unreported = 0;
  return Math.round(watched * 10) / 10;
}

/**
 * Cloudflare Stream player (captions, speed, picture-in-picture built in) that
 * reports watch time. The server decides what counts; this only measures how
 * long the video actually played between heartbeats.
 */
export function VideoPlayer({ videoId, src, customerCode, title, poster, startAt, onCompleted }: VideoPlayerProps) {
  const player = useRef<StreamPlayerApi | undefined>(undefined);
  const sessionId = useRef<string | null>(null);
  const creating = useRef<Promise<void> | null>(null);
  const clock = useRef<Clock>({ playingSince: null, unreported: 0 });
  const completed = useRef(false);
  const url = `/api/videos/${videoId}/progress`;

  const report = useCallback(
    async (ended = false, beacon = false) => {
      // Don't start a second session while the first is being created.
      if (creating.current) await creating.current;
      const body = JSON.stringify({
        sessionId: sessionId.current,
        position: player.current?.currentTime ?? 0,
        watched: takeWatched(clock.current),
        ended,
      });
      if (beacon && navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([body], { type: "text/plain" }));
        return;
      }
      const request = fetch(url, { method: "POST", body, keepalive: true })
        .then(async (res) => {
          if (res.status === 409) sessionId.current = null; // stale session: start a new one next time
          if (!res.ok) return;
          const data = (await res.json()) as { sessionId: string; completed: boolean };
          sessionId.current = data.sessionId;
          if (data.completed && !completed.current) {
            completed.current = true;
            onCompleted?.();
          }
        })
        .catch(() => {});
      if (!sessionId.current) {
        creating.current = request.finally(() => {
          creating.current = null;
        });
      }
      await request;
    },
    [url, onCompleted],
  );

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (clock.current.playingSince !== null) void report();
    }, HEARTBEAT_MS);
    const flush = () => {
      if (document.visibilityState === "hidden" && (clock.current.playingSince !== null || clock.current.unreported > 0)) void report(false, true);
    };
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("pagehide", flush);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("pagehide", flush);
    };
  }, [report]);

  return (
    // Fixed 16:9 frame so the page doesn't jump while Stream's SDK loads.
    <div className="aspect-video overflow-hidden rounded-xl bg-navy-950">
      <Stream
        src={src}
        customerCode={customerCode}
        controls
        responsive
        title={title}
        poster={poster ?? undefined}
        startTime={startAt && startAt > 0 ? startAt : undefined}
        primaryColor="#c48b2c"
        streamRef={player}
        onPlay={() => {
          clock.current.playingSince = Date.now();
          if (!sessionId.current) void report();
        }}
        onPause={() => {
          stopClock(clock.current);
          void report();
        }}
        onEnded={() => {
          stopClock(clock.current);
          void report(true);
        }}
      />
    </div>
  );
}

/** Shown where a player would be when Stream isn't configured (local development). */
export function PlayerUnavailable({ poster }: { poster?: string | null }) {
  return (
    <div className="relative aspect-video overflow-hidden rounded-xl bg-navy-950">
      {poster && (
        // eslint-disable-next-line @next/next/no-img-element -- Stream thumbnail
        <img src={poster} alt="" className="h-full w-full object-cover opacity-40" />
      )}
      <p className="absolute inset-0 flex items-center justify-center text-sm text-white/80">Video playback isn&apos;t available right now.</p>
    </div>
  );
}
