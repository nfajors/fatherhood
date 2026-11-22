import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        // The service worker must always be fetched fresh so updates reach installed apps.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      // Cloudflare Stream thumbnails.
      { protocol: "https", hostname: "*.cloudflarestream.com" },
    ],
  },
};

export default nextConfig;
