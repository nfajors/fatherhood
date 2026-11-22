/**
 * Offline downloads for members. Asks the server for a download (the first
 * request for a video may need a minute or two while Stream prepares it),
 * saves the MP4, and keeps each 30-day license fresh whenever the app is
 * online. Files go when a license runs out or is revoked, when he removes
 * them, and when he signs out.
 */
import { useNetworkState } from "expo-network";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState, Platform } from "react-native";
import { api, ApiError } from "../api/client";
import type { AppTarget, DownloadResponse } from "../api/types";
import { useAuth } from "../auth/AuthProvider";
import { afterSync, queueProgress, type QueuedProgress } from "../player/progressQueue";
import { applyChecks, isPlayable, needsCheck, type DownloadRecord, type LicenseCheck } from "./licenses";
import * as storage from "./storage";

export type DownloadItem = { videoId: string; title: string; context: string; durationSeconds: number | null; target: AppTarget };
export type ActiveDownload = { phase: "preparing" | "downloading"; percent: number };

type DownloadsValue = {
  supported: boolean;
  records: DownloadRecord[];
  active: Record<string, ActiveDownload>;
  errors: Record<string, string>;
  download(item: DownloadItem): Promise<void>;
  cancel(videoId: string): void;
  remove(videoId: string): Promise<void>;
  /** The local file to play, if this video is downloaded and its license is current. */
  localUri(videoId: string): string | null;
  /** Save his place in a video watched from a download; sent when the app is online. */
  recordOfflineProgress(item: QueuedProgress): void;
  sync(force?: boolean): Promise<void>;
};

const Ctx = createContext<DownloadsValue | null>(null);
const PREPARE_POLL_MS = 10_000;
const PREPARE_TRIES = 60;
const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), reject(new Error("cancelled"))), { once: true });
  });

export function DownloadsProvider({ children }: { children: ReactNode }) {
  const supported = Platform.OS !== "web";
  const auth = useAuth();
  const network = useNetworkState();
  const online = network.isConnected !== false && network.isInternetReachable !== false;
  const [records, setRecords] = useState<DownloadRecord[]>([]);
  const [active, setActive] = useState<Record<string, ActiveDownload>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const recordsRef = useRef<DownloadRecord[]>([]);
  const queueRef = useRef<QueuedProgress[]>([]);
  const controllers = useRef(new Map<string, AbortController>());
  const loaded = useRef(false);

  const commit = useCallback(async (next: DownloadRecord[]) => {
    recordsRef.current = next;
    setRecords(next);
    await storage.saveRecords(next);
  }, []);

  const removeFiles = useCallback((gone: DownloadRecord[]) => {
    for (const r of gone) storage.deleteVideoFile(r.fileName);
  }, []);

  const sync = useCallback(
    async (force = false) => {
      if (!supported || !loaded.current) return;
      const now = new Date();
      const current = recordsRef.current;
      let checks: LicenseCheck[] | null = null;
      if (online && current.length && (force || needsCheck(current, now))) {
        try {
          checks = (await api<{ licenses: LicenseCheck[] }>("/api/mobile/v1/downloads/check", { method: "POST", body: { videoIds: current.map((r) => r.videoId) } })).licenses;
        } catch {
          checks = null; // try again next time; expired files still go below
        }
      }
      const { keep, remove } = applyChecks(current, checks, now);
      removeFiles(remove);
      if (remove.length || checks) await commit(keep);

      const queue = queueRef.current;
      if (online && queue.length) {
        try {
          await api("/api/mobile/v1/progress", { method: "POST", body: { items: queue } });
          queueRef.current = afterSync(queueRef.current, queue);
          await storage.saveQueue(queueRef.current);
        } catch {
          // kept for the next sync
        }
      }
    },
    [supported, online, commit, removeFiles],
  );

  // Load what's on the phone once signed in.
  useEffect(() => {
    if (!supported || auth.status !== "signedIn" || loaded.current) return;
    (async () => {
      const [saved, queue] = await Promise.all([storage.loadRecords(), storage.loadQueue()]);
      // Keep only records whose file is really there.
      const present = saved.filter((r) => storage.videoFile(r.fileName).exists);
      recordsRef.current = present;
      queueRef.current = queue;
      setRecords(present);
      loaded.current = true;
      await sync();
    })();
  }, [supported, auth.status, sync]);

  // Check in when the app comes to the front, when the connection returns, and when membership changes.
  const member = auth.status === "signedIn" ? auth.me.member : null;
  useEffect(() => {
    void sync(member === false);
  }, [online, member, sync]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => state === "active" && void sync());
    return () => sub.remove();
  }, [sync]);

  // Signing out deletes every download and frees its license.
  useEffect(
    () =>
      auth.onSignOut(async () => {
        for (const c of controllers.current.values()) c.abort();
        const held = recordsRef.current;
        await Promise.all(held.map((r) => api(`/api/mobile/v1/downloads/${r.videoId}`, { method: "DELETE" }).catch(() => {})));
        if (supported) storage.deleteAll();
        recordsRef.current = [];
        queueRef.current = [];
        loaded.current = false;
        setRecords([]);
        setActive({});
      }),
    [auth, supported],
  );

  const setPhase = (videoId: string, value: ActiveDownload | null) =>
    setActive((a) => {
      const next = { ...a };
      if (value) next[videoId] = value;
      else delete next[videoId];
      return next;
    });

  const download = useCallback(
    async (item: DownloadItem) => {
      if (!supported || controllers.current.has(item.videoId)) return;
      const controller = new AbortController();
      controllers.current.set(item.videoId, controller);
      setErrors(({ [item.videoId]: _, ...rest }) => rest);
      setPhase(item.videoId, { phase: "preparing", percent: 0 });
      try {
        let ready: Extract<DownloadResponse, { status: "ready" }> | null = null;
        for (let i = 0; i < PREPARE_TRIES && !ready; i++) {
          const res = await api<DownloadResponse>(`/api/mobile/v1/downloads/${item.videoId}`, { method: "POST" });
          if (res.status === "ready") ready = res;
          else {
            setPhase(item.videoId, { phase: "preparing", percent: res.percentComplete });
            await sleep(PREPARE_POLL_MS, controller.signal);
          }
        }
        if (!ready) throw new ApiError(504, "timeout", "This video is taking a while to prepare. Try again later.");
        setPhase(item.videoId, { phase: "downloading", percent: 0 });
        const fileName = `${item.videoId}.mp4`;
        const size = await storage.downloadVideo(ready.url, fileName, (f) => setPhase(item.videoId, { phase: "downloading", percent: Math.round(f * 100) }), controller.signal);
        const now = new Date().toISOString();
        const record: DownloadRecord = { ...item, fileName, sizeBytes: size, licenseExpiresAt: ready.licenseExpiresAt, downloadedAt: now, lastCheckedAt: now };
        await commit([...recordsRef.current.filter((r) => r.videoId !== item.videoId), record]);
      } catch (error) {
        if (!controller.signal.aborted) {
          setErrors((e) => ({ ...e, [item.videoId]: error instanceof ApiError ? error.message : "The download didn't finish. Try again." }));
        }
      } finally {
        controllers.current.delete(item.videoId);
        setPhase(item.videoId, null);
      }
    },
    [supported, commit],
  );

  const cancel = useCallback((videoId: string) => controllers.current.get(videoId)?.abort(), []);

  const remove = useCallback(
    async (videoId: string) => {
      const record = recordsRef.current.find((r) => r.videoId === videoId);
      if (record) removeFiles([record]);
      await commit(recordsRef.current.filter((r) => r.videoId !== videoId));
      await api(`/api/mobile/v1/downloads/${videoId}`, { method: "DELETE" }).catch(() => {});
    },
    [commit, removeFiles],
  );

  const localUri = useCallback(
    (videoId: string) => {
      const record = records.find((r) => r.videoId === videoId);
      return record && isPlayable(record, new Date()) ? storage.videoFile(record.fileName).uri : null;
    },
    [records],
  );

  const recordOfflineProgress = useCallback((item: QueuedProgress) => {
    queueRef.current = queueProgress(queueRef.current, item);
    void storage.saveQueue(queueRef.current);
  }, []);

  const value = useMemo(
    () => ({ supported, records, active, errors, download, cancel, remove, localUri, recordOfflineProgress, sync }),
    [supported, records, active, errors, download, cancel, remove, localUri, recordOfflineProgress, sync],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDownloads(): DownloadsValue {
  const value = useContext(Ctx);
  if (!value) throw new Error("useDownloads outside DownloadsProvider");
  return value;
}
