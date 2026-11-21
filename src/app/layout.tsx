import type { Metadata, Viewport } from "next";
import { Inter, Source_Serif_4 } from "next/font/google";
import type { ReactNode } from "react";
import { ServiceWorkerRegistration } from "@/components/pwa/service-worker";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { SITE } from "@/lib/config";
import { appUrl } from "@/lib/env";
import "./globals.css";

const serif = Source_Serif_4({ subsets: ["latin"], variable: "--font-source-serif", display: "swap" });
const sans = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(appUrl()),
  title: { default: `${SITE.name}: education for fathers`, template: `%s | ${SITE.name}` },
  description: SITE.tagline,
  openGraph: { siteName: SITE.name, type: "website" },
  applicationName: SITE.name,
  appleWebApp: { capable: true, title: "Fatherhood", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#070f1f",
  // Lets the installed app use the whole screen; the header and footer pad for notches.
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable}`}>
      <body className="flex min-h-screen flex-col">
        <SiteHeader />
        <main className="min-w-0 flex-1">{children}</main>
        <SiteFooter />
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
