import Link from "next/link";
import { HeaderAccount } from "@/components/header-account";
import { SITE } from "@/lib/config";

const NAV = [
  { href: "/themes", label: "Themes" },
  { href: "/academy", label: "Academy" },
  { href: "/community", label: "Community Voices" },
  { href: "/book", label: "The Book" },
  { href: "/pricing", label: "Pricing" },
];

export function SiteHeader() {
  return (
    <header className="border-b border-white/10 bg-navy-950 text-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <Link href="/" className="font-serif text-xl font-semibold tracking-tight">
          Fatherhood<span className="text-gold-400">.School</span>
          <span className="sr-only"> ({SITE.domain}) home</span>
        </Link>
        <nav aria-label="Main" className="order-3 flex w-full gap-5 overflow-x-auto text-sm text-white/80 sm:order-none sm:w-auto">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className="whitespace-nowrap hover:text-white">
              {item.label}
            </Link>
          ))}
        </nav>
        <HeaderAccount />
      </div>
    </header>
  );
}
