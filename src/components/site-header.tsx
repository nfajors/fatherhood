import Link from "next/link";
import { HeaderAccount } from "@/components/header-account";
import { MobileMenu } from "@/components/mobile-menu";
import { SITE } from "@/lib/config";

const NAV = [
  { href: "/themes", label: "Themes" },
  { href: "/academy", label: "Academy" },
  { href: "/community", label: "Community Voices" },
  { href: "/book", label: "The Book" },
  { href: "/pricing", label: "Pricing" },
];

const SearchIcon = () => (
  <svg aria-hidden viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="size-5">
    <circle cx="8.5" cy="8.5" r="5.5" />
    <path d="m13 13 4.5 4.5" strokeLinecap="round" />
  </svg>
);

/** Full navigation on wide screens (xl, where an admin's links fit); logo, search and a menu below that. */
export function SiteHeader() {
  return (
    <header className="relative border-b border-white/10 bg-navy-950 pt-[env(safe-area-inset-top)] text-white print:hidden">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2.5 sm:px-6 xl:py-4">
        <Link href="/" className="shrink-0 font-serif text-xl font-semibold tracking-tight">
          Fatherhood<span className="text-gold-400">.School</span>
          <span className="sr-only"> ({SITE.domain}) home</span>
        </Link>
        <nav aria-label="Main" className="hidden gap-5 text-sm text-white/80 xl:flex">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className="whitespace-nowrap hover:text-white">
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-1">
          <Link href="/search" aria-label="Search" className="flex size-11 items-center justify-center rounded-md text-white/80 hover:bg-white/10 hover:text-white xl:size-9">
            <SearchIcon />
          </Link>
          <div className="hidden xl:block">
            <HeaderAccount />
          </div>
          <div className="flex items-center gap-1 xl:hidden">
            <MobileMenu nav={NAV} />
          </div>
        </div>
      </div>
    </header>
  );
}
