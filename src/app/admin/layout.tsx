import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { getAdminUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

const LINKS = [
  { href: "/admin/moderation", label: "Moderation" },
  { href: "/admin/themes", label: "Themes" },
];

/** Admin area: hidden (404) from everyone but admins. */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  if (!(await getAdminUser())) notFound();
  return (
    <div>
      <nav aria-label="Admin" className="border-b border-navy-900/10 bg-white">
        <div className="mx-auto flex max-w-6xl gap-6 overflow-x-auto px-4 py-3 text-sm sm:px-6">
          <span className="font-semibold text-gold-600">Admin</span>
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
