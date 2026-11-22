import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { getSessionUser, type SessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { canPost, moderatedGroupIds } from "@/lib/discussions/service";
import { cn } from "@/lib/utils";

/** Discussions are for signed-in people: anyone reads, members post. */
export async function discussionViewer(next: string): Promise<{ viewer: SessionUser; canPost: boolean; canModerateAny: boolean }> {
  const viewer = await getSessionUser();
  if (!viewer) redirect(`/sign-in?next=${encodeURIComponent(next)}`);
  const db = getDb();
  const [posting, moderated] = await Promise.all([canPost(db, viewer), viewer.role === "admin" ? Promise.resolve(["*"]) : moderatedGroupIds(db, viewer.id)]);
  return { viewer, canPost: posting, canModerateAny: moderated.length > 0 };
}

const TABS = [
  { href: "/discussions", label: "Everyone" },
  { href: "/discussions?view=following", label: "Following" },
  { href: "/discussions/groups", label: "Groups" },
];

export function DiscussionsShell({ active, canModerateAny, children }: { active: string; canModerateAny: boolean; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-3xl font-semibold">Discussions</h1>
        {canModerateAny && (
          <Link href="/discussions/moderate" className="text-sm font-semibold underline-offset-2 hover:underline">
            Moderation queue
          </Link>
        )}
      </div>
      <nav aria-label="Discussions" className="mt-4 flex gap-1 border-b border-navy-900/10 text-sm">
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            aria-current={t.href === active ? "page" : undefined}
            className={cn("-mb-px border-b-2 px-3 py-2", t.href === active ? "border-gold-500 font-semibold text-navy-900" : "border-transparent text-muted hover:text-navy-900")}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <div className="mt-6">{children}</div>
      <p className="mt-10 text-xs text-muted">
        Be kind and keep children&apos;s details private. Posts are checked by AI and our moderators; report anything that doesn&apos;t belong. Names show as first name
        and last initial.
      </p>
    </div>
  );
}

export function MembersPostNote() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-navy-900/10 bg-white p-4 text-sm">
      <p>Reading is open to everyone with an account. Posting and replying are part of membership.</p>
      <Button asChild size="sm">
        <Link href="/pricing">See membership</Link>
      </Button>
    </div>
  );
}
