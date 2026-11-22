import type { Metadata } from "next";
import { CoachChat } from "@/components/coach/chat";
import { CoachBlocked, CoachShell, coachMember } from "@/components/coach/shell";

export const metadata: Metadata = { title: "Coach", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function CoachPage() {
  const access = await coachMember("/coach");
  if ("blocked" in access) return <CoachBlocked reason={access.blocked} />;
  const firstName = access.member.name.trim().split(/\s+/)[0] ?? "";
  return (
    <CoachShell member={access.member} activeId={null}>
      <h1 className="sr-only">Coach</h1>
      <CoachChat key="new" conversationId={null} initialMessages={[]} firstName={firstName} />
    </CoachShell>
  );
}
