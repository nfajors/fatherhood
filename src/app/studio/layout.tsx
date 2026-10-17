import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

const LINKS = [
  { href: "/studio", label: "Dashboard" },
  { href: "/studio/upload", label: "Upload" },
  { href: "/studio/earnings", label: "Earnings" },
];

/** The creator Studio: Fellows and admins. Everyone else is sent to the Fellows page. */
export default async function StudioLayout({ children }: { children: ReactNode }) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect("/sign-in?next=/studio");
  if (sessionUser.role === "user") redirect("/fellows");
  return (
    <div>
      <nav aria-label="Studio" className="border-b border-navy-900/10 bg-white">
        <div className="mx-auto flex max-w-6xl gap-6 overflow-x-auto px-4 py-3 text-sm sm:px-6">
          <span className="font-semibold text-gold-600">Studio</span>
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="whitespace-nowrap text-navy-900 hover:underline">
              {l.label}
            </Link>
          ))}
        </div>
      </nav>
      {children}
    </div>
  );
}
