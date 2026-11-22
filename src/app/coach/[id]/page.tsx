import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { CoachChat } from "@/components/coach/chat";
import { DeleteConversationButton } from "@/components/coach/plan-forms";
import { CoachBlocked, CoachShell, coachMember } from "@/components/coach/shell";
import { getConversation } from "@/lib/coach/conversations";
import { getDb } from "@/lib/db";

export const metadata: Metadata = { title: "Coach", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function CoachConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await coachMember(`/coach/${id}`);
  if ("blocked" in access) return <CoachBlocked reason={access.blocked} />;
  const conversationId = z.uuid().safeParse(id);
  const conversation = conversationId.success ? await getConversation(getDb(), access.member.id, conversationId.data) : null;
  if (!conversation) notFound();
  return (
    <CoachShell member={access.member} activeId={conversation.id}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-navy-900/10 pb-3">
        <h1 className="min-w-0 truncate font-serif text-xl font-semibold">{conversation.title}</h1>
        <DeleteConversationButton id={conversation.id} />
      </div>
      <CoachChat
        key={conversation.id}
        conversationId={conversation.id}
        initialMessages={conversation.messages.map((m) => ({ id: m.id, role: m.role, content: m.content }))}
        firstName={access.member.name.trim().split(/\s+/)[0] ?? ""}
      />
    </CoachShell>
  );
}
