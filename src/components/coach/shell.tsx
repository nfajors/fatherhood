import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { getSessionUser, type SessionUser } from "@/lib/auth";
import { canUseCoach, coachConfigured } from "@/lib/coach/access";
import { COACH_POLICY } from "@/lib/coach/policy";
import { listConversations } from "@/lib/coach/conversations";
import { getPath } from "@/lib/coach/path";
import { getDb } from "@/lib/db";
import { cn } from "@/lib/utils";
import { SafetyNote } from "./safety-note";

/** The signed-in member, or a reason the coach can't be shown (sign-in happens by redirect). */
export async function coachMember(next: string): Promise<{ member: SessionUser } | { blocked: "membership" | "unavailable" }> {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect(`/sign-in?next=${encodeURIComponent(next)}`);
  if (!(await canUseCoach(getDb(), sessionUser))) return { blocked: "membership" };
  if (!coachConfigured()) return { blocked: "unavailable" };
  return { member: sessionUser };
}

export function CoachBlocked({ reason }: { reason: "membership" | "unavailable" }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      <p className="text-sm font-semibold uppercase tracking-[0.2em] text-gold-600">Coach</p>
      <h1 className="mt-2 text-4xl font-semibold">A coach in your pocket</h1>
      {reason === "membership" ? (
        <>
          <p className="mt-4 text-lg text-muted">
            Talk through what&apos;s happening at home with an AI coach that knows every lesson in the academy and what you&apos;ve been working
            on. It suggests what to watch next and plans a learning path around your family. The coach is part of membership.
          </p>
          <Button asChild className="mt-8">
            <Link href="/pricing">See membership</Link>
          </Button>
        </>
      ) : (
        <p className="mt-4 text-lg text-muted">The coach isn&apos;t available right now. Please check back soon.</p>
      )}
    </div>
  );
}

/** Coach pages: conversations and the plan on the side (in a menu on phones), the page itself in the middle. */
export async function CoachShell({ member, activeId, children }: { member: SessionUser; activeId: string | null; children: ReactNode }) {
  const db = getDb();
  const [conversations, path] = await Promise.all([listConversations(db, member.id), getPath(db, member.id)]);
  const list = (
    <nav aria-label="Coach conversations" className="space-y-4">
      <Button asChild className="w-full">
        <Link href="/coach">New conversation</Link>
      </Button>
      <Link href="/coach/plan" className={cn("block rounded-lg border border-navy-900/10 bg-white p-3 text-sm hover:border-gold-500", activeId === "plan" && "border-gold-500")}>
        <span className="font-semibold">Your plan</span>
        <span className="block text-muted">
          {path ? (path.next ? `Next: ${path.next.title}` : "All done. Plan your next steps.") : "Tell the coach about you and get a learning path"}
        </span>
      </Link>
      {conversations.length > 0 && (
        <ul className="space-y-1 text-sm">
          {conversations.map((c) => (
            <li key={c.id}>
              <Link
                href={`/coach/${c.id}`}
                aria-current={c.id === activeId ? "page" : undefined}
                className={cn("block truncate rounded-md px-3 py-2 hover:bg-navy-100", c.id === activeId && "bg-navy-100 font-semibold")}
              >
                {c.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="grid gap-8 lg:grid-cols-[16rem_1fr]">
        <aside className="hidden lg:block">{list}</aside>
        <details className="rounded-lg border border-navy-900/10 bg-white p-3 lg:hidden">
          <summary className="cursor-pointer text-sm font-semibold">Conversations and your plan</summary>
          <div className="mt-3">{list}</div>
        </details>
        <div className="min-w-0">
          {children}
          <div className="mt-6">
            <SafetyNote />
          </div>
          <p className="mt-3 text-xs text-muted">
            Your conversations are private: our team doesn&apos;t read them. You can delete any conversation. Up to {COACH_POLICY.dailyMessages} messages a day.
          </p>
        </div>
      </div>
    </div>
  );
}
