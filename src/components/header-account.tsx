"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

/** Right side of the header. Client-side, so marketing pages stay static. */
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
  const role = (data.user as { role?: string }).role;
  return (
    <div className="flex items-center gap-1 text-sm">
      {role === "admin" && (
        <Button asChild variant="ghost" size="sm" className="text-white hover:bg-white/10">
          <Link href="/admin/moderation">Admin</Link>
        </Button>
      )}
      <Button asChild variant="ghost" size="sm" className="text-white hover:bg-white/10">
        <Link href="/learning">My Learning</Link>
      </Button>
      <Button asChild variant="ghost" size="sm" className="text-white hover:bg-white/10">
        <Link href="/account">Account</Link>
      </Button>
    </div>
  );
}
