import Link from "next/link";
import { InstallAppButton } from "@/components/pwa/install-button";
import { RegionSelect } from "@/components/region/region-select";
import { currentRegion } from "@/lib/region-server";
import { SITE } from "@/lib/config";

export async function SiteFooter() {
  const region = await currentRegion();
  return (
    <footer className="mt-24 border-t border-navy-900/10 bg-white pb-[env(safe-area-inset-bottom)] print:hidden">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-10 text-sm text-muted sm:flex-row sm:justify-between sm:px-6">
        <div className="space-y-3">
          <p>
            © {new Date().getFullYear()} {SITE.name}. Companion academy to <em>{SITE.bookTitle}</em>.
          </p>
          <RegionSelect current={region.code} />
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2 whitespace-nowrap">
          <Link href="/pricing">Pricing</Link>
          <Link href="/gift">Give a gift</Link>
          <Link href="/redeem">Redeem a gift</Link>
          <Link href="/book">The Book</Link>
          <Link href="/community">Community Voices</Link>
          <Link href="/collections">Collections</Link>
          <Link href="/fellows">Become a Fellow</Link>
          <Link href="/for-organizations">For organizations</Link>
          <InstallAppButton className="font-semibold text-navy-900 underline-offset-2 hover:underline" />
        </nav>
      </div>
    </footer>
  );
}
