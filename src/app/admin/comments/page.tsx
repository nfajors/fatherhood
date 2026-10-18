import type { Metadata } from "next";
import Link from "next/link";
import { CommentModerationButtons } from "@/components/admin/comment-actions";
import { moderationList } from "@/lib/comments/service";
import { getDb } from "@/lib/db";
import { REPORT_REASONS, type ReportReason } from "@/lib/moderation/policy";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Comments (admin)", robots: { index: false } };

export default async function AdminCommentsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const { show } = await searchParams;
  const filter = show === "recent" ? "recent" : "reported";
  const rows = await moderationList(getDb(), { filter });

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-semibold">Comments</h1>
      <p className="mt-2 text-muted">
        Comments hide automatically once three people report them. Restore what&apos;s fine (the reports are dismissed), hide what isn&apos;t, or
        remove it for good.
      </p>
      <nav aria-label="Filter" className="mt-6 flex gap-2 text-sm">
        {(
          [
            ["reported", "Reported or hidden"],
            ["recent", "All recent"],
          ] as const
        ).map(([value, label]) => (
          <Link
            key={value}
            href={value === "reported" ? "/admin/comments" : "/admin/comments?show=recent"}
            aria-current={filter === value ? "page" : undefined}
            className={cn("rounded-full px-3 py-1", filter === value ? "bg-navy-900 text-white" : "border border-navy-900/15 bg-white")}
          >
            {label}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <p className="mt-6 text-sm text-muted">{filter === "reported" ? "Nothing reported. All quiet." : "No comments yet."}</p>
      ) : (
        <ul className="mt-6 divide-y divide-navy-900/10 rounded-xl border border-navy-900/10 bg-white">
          {rows.map((c) => (
            <li key={c.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm">
                    <span className="font-medium">{c.authorName}</span> <span className="text-muted">{c.authorEmail}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    on{" "}
                    <Link href={c.videoType === "community" ? `/community/${c.videoId}#comments` : `/admin/moderation/${c.videoId}`} className="underline">
                      {c.videoTitle}
                    </Link>{" "}
                    · {c.createdAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
                    {c.status === "hidden" && <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 font-semibold text-red-800">Hidden</span>}
                    {c.openReports > 0 && (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-900">
                        {c.openReports} {c.openReports === 1 ? "report" : "reports"}: {c.reasons.map((r) => REPORT_REASONS[r as ReportReason] ?? r).join(", ")}
                      </span>
                    )}
                  </p>
                </div>
                <CommentModerationButtons commentId={c.id} status={c.status} />
              </div>
              <p className="mt-2 whitespace-pre-line break-words text-sm">{c.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
