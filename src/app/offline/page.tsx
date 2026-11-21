import type { Metadata } from "next";
import { RetryButton } from "@/components/pwa/retry-button";

export const metadata: Metadata = { title: "Offline", robots: { index: false } };

/**
 * Shown by the service worker when a page can't load without a connection.
 * Static, so the worker can keep a copy; it must not depend on who is signed in.
 */
export default function OfflinePage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-20 text-center sm:px-6">
      <h1 className="text-3xl font-semibold">You&apos;re offline</h1>
      <p className="mt-3 text-muted">
        Fatherhood.School needs a connection to load lessons and videos. Check your Wi-Fi or mobile data, then try again. Your progress is
        saved up to the last moment you were online.
      </p>
      <div className="mt-8">
        <RetryButton />
      </div>
    </div>
  );
}
