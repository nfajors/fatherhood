import type { MetadataRoute } from "next";
import { SITE } from "@/lib/config";

/** Web app manifest: lets phones install Fatherhood.School to the home screen. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: SITE.name,
    short_name: "Fatherhood",
    description: SITE.tagline,
    start_url: "/learning?source=app",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#fbfaf7",
    theme_color: "#070f1f",
    categories: ["education", "lifestyle"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "My Learning", short_name: "Learning", url: "/learning?source=app", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Community Voices", short_name: "Community", url: "/community?source=app", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Academy", url: "/academy?source=app", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
