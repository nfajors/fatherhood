/**
 * The player. Reports every 15 seconds: to the server while online (views,
 * the creator pool and his place), or into the offline queue when there's no
 * connection (his place only).
 */
import { useEventListener } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEffect, useRef } from "react";
import { StyleSheet } from "react-native";
import { api, ApiError } from "../api/client";
import { useDownloads } from "../downloads/DownloadsProvider";
import { HEARTBEAT_SECONDS, WatchMeter } from "./meter";
import { isFinished } from "./progressQueue";

type Props = { videoId: string; uri: string; startAt: number; durationSeconds: number | null; onFinished?: () => void };

export function VideoPlayer({ videoId, uri, startAt, durationSeconds, onFinished }: Props) {
  const downloads = useDownloads();
  const meter = useRef(new WatchMeter());
  const session = useRef<string | null>(null);
  const position = useRef(startAt);
  const playing = useRef(false);
  const lastReport = useRef(0);
  const finished = useRef(false);
  // One heartbeat at a time, so the first one's session id is used by the next.
  const chain = useRef<Promise<void>>(Promise.resolve());

  const player = useVideoPlayer(uri, (p) => {
    p.timeUpdateEventInterval = 1;
    p.staysActiveInBackground = false;
    if (startAt > 0) p.currentTime = startAt;
    p.play();
  });

  const report = (ended: boolean) => {
    chain.current = chain.current.then(() => send(ended));
    return chain.current;
  };

  const send = async (ended: boolean) => {
    const watched = meter.current.take();
    const pos = Math.floor(position.current);
    const completed = ended || isFinished(pos, durationSeconds);
    try {
      const res = await api<{ sessionId: string; completed: boolean }>(`/api/videos/${videoId}/progress`, {
        method: "POST",
        text: true,
        body: { sessionId: session.current, position: pos, watched: Math.min(watched, 3600), ended },
      });
      session.current = res.sessionId;
    } catch (error) {
      if (error instanceof ApiError && error.offline) {
        downloads.recordOfflineProgress({ videoId, positionSeconds: pos, completed, recordedAt: new Date().toISOString() });
      } else if (error instanceof ApiError && error.code === "session_mismatch") {
        session.current = null;
      }
    }
  };

  useEventListener(player, "timeUpdate", ({ currentTime }) => {
    position.current = currentTime;
    meter.current.tick(currentTime, playing.current);
    const now = Date.now();
    if (playing.current && now - lastReport.current >= HEARTBEAT_SECONDS * 1000) {
      lastReport.current = now;
      void report(false);
    }
  });
  useEventListener(player, "playingChange", ({ isPlaying }) => {
    playing.current = isPlaying;
    if (!isPlaying && lastReport.current) void report(false); // keep his place when he pauses
  });
  useEventListener(player, "playToEnd", () => {
    if (finished.current) return;
    finished.current = true;
    void report(true);
    onFinished?.();
  });

  // The first heartbeat starts the session; the last one saves his place when he leaves.
  useEffect(() => {
    lastReport.current = Date.now();
    void report(false);
    return () => {
      if (!finished.current) void report(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <VideoView player={player} style={styles.video} nativeControls allowsPictureInPicture fullscreenOptions={{ enable: true }} contentFit="contain" />;
}

const styles = StyleSheet.create({
  video: { width: "100%", aspectRatio: 16 / 9, backgroundColor: "#000" },
});
