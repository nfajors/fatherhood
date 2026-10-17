import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  images: {
    remotePatterns: [
      // Cloudflare Stream thumbnails.
      { protocol: "https", hostname: "*.cloudflarestream.com" },
    ],
  },
};

export default nextConfig;
