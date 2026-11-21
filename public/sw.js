/*
 * Fatherhood.School service worker.
 *
 * Deliberately small, because pages show account and membership state:
 * - Pages always come from the network. When the network fails, the offline page is shown.
 *   Pages are never cached, so nothing personal stays on a shared phone and no one sees a
 *   stale paywall.
 * - Build files under /_next/static/ have content hashes, so they are cached on first use
 *   and served from the cache after that (fast starts, and the offline page keeps its styles).
 * - Icons are cached. API calls, video (Cloudflare) and other sites are never touched.
 */
const VERSION = "v1";
const STATIC_CACHE = `fs-static-${VERSION}`;
const OFFLINE_CACHE = `fs-offline-${VERSION}`;
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(OFFLINE_CACHE);
      const response = await fetch(OFFLINE_URL, { cache: "reload" });
      if (!response.ok) throw new Error(`Could not cache ${OFFLINE_URL}`);
      // Keep the offline page's own styles, scripts and fonts with it.
      const html = await response.clone().text();
      const assets = [...new Set(html.match(/\/_next\/static\/[^"'\s)]+/g) ?? [])];
      await cache.put(OFFLINE_URL, response);
      const statics = await caches.open(STATIC_CACHE);
      await Promise.all(["/icons/icon-192.png", ...assets].map((url) => statics.add(url).catch(() => undefined)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([STATIC_CACHE, OFFLINE_CACHE]);
      for (const key of await caches.keys()) if (key.startsWith("fs-") && !keep.has(key)) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => (await caches.match(OFFLINE_URL, { cacheName: OFFLINE_CACHE })) ?? Response.error()),
    );
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      })(),
    );
  }
});
