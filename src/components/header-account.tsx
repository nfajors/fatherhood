"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

/** Account links for the signed-in user's role, in header order. */
export function accountLinks(role: string | undefined) {
  return [
    ...(role === "admin" ? [{ href: "/admin/moderation", label: "Admin" }] : []),
    ...(role === "creator" || role === "admin" ? [{ href: "/studio", label: "Studio" }] : []),
    { href: "/learning", label: "My Learning" },
    { href: "/coach", label: "Coach" },
    { href: "/account", label: "Account" },
  ];
}

/** Right side of the header on wide screens. Client-side, so marketing pages stay static. */
export function HeaderAccount() {
  const { data, isPending } = authClient.useSession();
  if (isPending) return <div className="h-9 w-32" aria-hidden />;
  if (!data) {
    return (
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm" className="text-white hover:bg-white/10">
          <Link href="/sign-in">Sign in</Link>
        </Button>
        <Button asChild size="sm">
          <Link href="/pricing">Join</Link>
        </Button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1 text-sm">
      {accountLinks((data.user as { role?: string }).role).map((l) => (
        <Button key={l.href} asChild variant="ghost" size="sm" className="whitespace-nowrap text-white hover:bg-white/10">
          <Link href={l.href}>{l.label}</Link>
        </Button>
      ))}
    </div>
  );
}
