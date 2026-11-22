import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PostActions } from "@/components/discussions/actions";
import { DiscussionsShell, discussionViewer } from "@/components/discussions/shell";
import { getDb } from "@/lib/db";
import { timeAgo } from "@/lib/discussions/format";
import { POST_RISKS } from "@/lib/discussions/policy";
import { moderationQueue } from "@/lib/discussions/service";
import { REPORT_REASONS } from "@/lib/moderation/policy";

export const metadata: Metadata = { title: "Moderation queue", robots: { index: false } };
export const dynamic = "force-dynamic";

const label = (c: string) => (c in POST_RISKS ? POST_RISKS[c as keyof typeof POST_RISKS] : c === "declined" ? "The AI check declined to assess it" : "Something else");

/** Held and reported posts, for admins (everything) and group moderators (their groups). */
export default async function ModerationQueuePage() {
  const { viewer, canModerateAny } = await discussionViewer("/discussions/moderate");
  if (!canModerateAny) notFound();
  const queue = await moderationQueue(getDb(), viewer);
  return (
    <DiscussionsShell active="" canModerateAny>
      <h2 className="text-2xl font-semibold">Moderation queue</h2>
      <p className="mt-1 text-sm text-muted">
        Posts the AI check held, posts it couldn&apos;t check yet, and posts readers reported. Approve what&apos;s fine; hide or remove what isn&apos;t. Authors see
        their held posts marked as waiting.
      </p>
      {queue.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-navy-900/20 p-6 text-center text-muted">Nothing waiting. Nice work.</p>
      ) : (
        <ul className="mt-6 space-y-4">
          {queue.map((q) => (
            <li key={q.id} className="rounded-xl border border-navy-900/10 bg-white p-4">
              <p className="text-sm">
                <strong>{q.status === "pending" ? (q.screenedAt ? "Held by the AI check" : "Not checked yet") : q.status === "hidden" ? "Hidden" : "Reported"}</strong>
                <span className="text-muted">
                  {" "}
                  · {q.authorName} ({q.authorEmail}){q.groupName && ` · ${q.groupName}`} · {timeAgo(q.createdAt)}
                </span>
              </p>
              {q.parentBody && <p className="mt-2 border-l-2 border-navy-900/10 pl-3 text-sm text-muted">Replying to: {q.parentBody.slice(0, 300)}</p>}
              <p className="mt-2 whitespace-pre-wrap break-words">{q.body}</p>
              {q.screenCategories.length > 0 && (
                <p className="mt-2 text-sm">
                  <span className="font-semibold">AI flagged:</span> {q.screenCategories.map(label).join("; ")}
                  {q.screenReason && <span className="text-muted"> ({q.screenReason})</span>}
                </p>
              )}
              {q.openReports > 0 && (
                <p className="mt-1 text-sm">
                  <span className="font-semibold">
                    {q.openReports} {q.openReports === 1 ? "report" : "reports"}:
                  </span>{" "}
                  {q.reasons.map((r) => REPORT_REASONS[r as keyof typeof REPORT_REASONS] ?? r).join("; ")}
                </p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <PostActions postId={q.id} isOwn={false} body={q.body} canModerate status={q.status === "pending" ? "pending" : q.status === "hidden" ? "hidden" : "visible"} isReply={Boolean(q.parentId)} />
                <Link href={`/discussions/${q.parentId ?? q.id}`} className="text-sm underline-offset-2 hover:underline">
                  Open the thread
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </DiscussionsShell>
  );
}
