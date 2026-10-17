import Link from "next/link";
import { SITE } from "@/lib/config";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-navy-900/10 bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-10 text-sm text-muted sm:flex-row sm:justify-between sm:px-6">
        <p>
          © {new Date().getFullYear()} {SITE.name}. Companion academy to <em>{SITE.bookTitle}</em>.
        </p>
        <nav aria-label="Footer" className="flex gap-5">
          <Link href="/pricing">Pricing</Link>
          <Link href="/book">The Book</Link>
          <Link href="/community">Community Voices</Link>
        </nav>
      </div>
    </footer>
  );
}
