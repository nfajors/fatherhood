"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Upload } from "tus-js-client";
import { Button } from "@/components/ui/button";
import type { VideoType } from "@/lib/db/schema";
import { fileProblem, formatBytes, uploadErrorMessage } from "./upload-checks";

/** Cloudflare wants tus chunks of at least 5 MB in multiples of 256 KB; 50 MB is its recommendation. */
const CHUNK_SIZE = 50 * 1024 * 1024;

/** The video's length from the file itself, or null when the browser can't read it (Cloudflare still enforces the cap). */
export function readDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let settled = false;
    const done = (value: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = setTimeout(() => done(null), 10_000);
    video.preload = "metadata";
    video.onloadedmetadata = () => done(Number.isFinite(video.duration) ? video.duration : null);
    video.onerror = () => done(null);
    video.src = url;
  });
}

/** Check a chosen file before uploading it. */
export async function checkFile(file: File, type: VideoType): Promise<string | null> {
  return fileProblem(file, await readDuration(file), type);
}

export type UploadState =
  | { phase: "idle" }
  | { phase: "uploading" | "paused"; sent: number; total: number }
  | { phase: "done" }
  | { phase: "error"; message: string; sent: number; total: number };

/**
 * Resumable upload straight to Cloudflare. Our server only starts it (see
 * /api/studio/videos/[id]/upload). If the tab closes, choosing the same file
 * again for the same video resumes where it stopped.
 */
export function useResumableUpload(onDone: (videoId: string) => void) {
  const [state, setState] = useState<UploadState>({ phase: "idle" });
  const upload = useRef<Upload | null>(null);
  const progress = useRef({ sent: 0, total: 0 });

  const busy = state.phase === "uploading";
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  const start = useCallback(
    async (videoId: string, file: File) => {
      progress.current = { sent: 0, total: file.size };
      setState({ phase: "uploading", ...progress.current });
      const next = new Upload(file, {
        endpoint: `/api/studio/videos/${videoId}/upload`,
        chunkSize: CHUNK_SIZE,
        retryDelays: [0, 3_000, 10_000, 30_000],
        removeFingerprintOnSuccess: true,
        metadata: { filename: file.name, filetype: file.type },
        onProgress: (sent, total) => {
          progress.current = { sent, total };
          setState((s) => (s.phase === "uploading" ? { phase: "uploading", sent, total } : s));
        },
        onSuccess: async () => {
          // Let the server confirm the file arrived; Stream's webhook takes it from there either way.
          await fetch(`/api/studio/videos/${videoId}/uploaded`, { method: "POST" }).catch(() => {});
          setState({ phase: "done" });
          onDone(videoId);
        },
        onError: (error) => setState({ phase: "error", message: uploadErrorMessage(error), ...progress.current }),
      });
      upload.current = next;
      const previous = await next.findPreviousUploads();
      if (previous[0]) next.resumeFromPreviousUpload(previous[0]);
      next.start();
    },
    [onDone],
  );

  const pause = useCallback(() => {
    void upload.current?.abort();
    setState({ phase: "paused", ...progress.current });
  }, []);

  const resume = useCallback(() => {
    setState({ phase: "uploading", ...progress.current });
    upload.current?.start();
  }, []);

  return { state, start, pause, resume };
}

export function UploadProgress({ state, onPause, onResume }: { state: UploadState; onPause: () => void; onResume: () => void }) {
  if (state.phase === "idle") return null;
  if (state.phase === "done") {
    return (
      <p role="status" className="rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
        ✓ Uploaded. Cloudflare is processing it now; we&apos;ll review it once that&apos;s done.
      </p>
    );
  }
  const percent = state.total ? Math.floor((state.sent / state.total) * 100) : 0;
  return (
    <div className="rounded-md border border-navy-900/10 bg-white p-4">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-semibold">{state.phase === "paused" ? "Paused" : state.phase === "error" ? "Upload stopped" : "Uploading…"}</span>
        <span className="tabular-nums text-muted">
          {formatBytes(state.sent)} of {formatBytes(state.total)} · {percent}%
        </span>
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-gold-100"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label="Upload progress"
      >
        <div className="h-full rounded-full bg-gold-600 transition-[width]" style={{ width: `${percent}%` }} />
      </div>
      {state.phase === "error" && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {state.message}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        {state.phase === "uploading" ? (
          <Button type="button" size="sm" variant="outline" onClick={onPause}>
            Pause
          </Button>
        ) : (
          <Button type="button" size="sm" onClick={onResume}>
            Resume
          </Button>
        )}
      </div>
      {state.phase === "uploading" && <p className="mt-3 text-xs text-muted">Keep this page open until the upload finishes.</p>}
    </div>
  );
}
