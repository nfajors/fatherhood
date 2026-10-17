"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorText, useAdminAction } from "./use-admin-action";

type Status = "pending_review" | "changes_requested" | "approved" | "unpublished" | "rejected" | string;
type Decision = "approve" | "request_changes" | "reject" | "unpublish" | "restore";

const LABELS: Record<Decision, string> = {
  approve: "Approve and publish",
  request_changes: "Request changes",
  reject: "Reject",
  unpublish: "Unpublish",
  restore: "Restore",
};

const NEEDS_NOTES: Decision[] = ["request_changes", "reject", "unpublish"];

function decisionsFor(status: Status): Decision[] {
  if (status === "pending_review") return ["approve", "request_changes", "reject"];
  if (status === "changes_requested") return ["approve", "reject"];
  if (status === "approved") return ["unpublish"];
  if (status === "unpublished") return ["restore"];
  return [];
}

/** Decision panel on the review page. Notes go to the creator and are required for negative decisions. */
export function ReviewActions({ videoId, status }: { videoId: string; status: Status }) {
  const { pending, error, run } = useAdminAction();
  const [chosen, setChosen] = useState<Decision | null>(null);
  const [notes, setNotes] = useState("");
  const decisions = decisionsFor(status);
  if (decisions.length === 0) return <p className="text-sm text-muted">No decisions are available for a {status.replace("_", " ")} video.</p>;

  const submit = (decision: Decision) =>
    run(`/api/admin/moderation/${videoId}/review`, "POST", { action: decision, notes: notes.trim() || undefined }, () => {
      setChosen(null);
      setNotes("");
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {decisions.map((d) => (
          <Button
            key={d}
            size="sm"
            variant={d === "approve" || d === "restore" ? "primary" : d === "request_changes" ? "outline" : "secondary"}
            disabled={pending}
            aria-pressed={chosen === d}
            onClick={() => (NEEDS_NOTES.includes(d) ? setChosen(d) : submit(d))}
          >
            {LABELS[d]}
          </Button>
        ))}
      </div>
      {chosen && (
        <div className="space-y-2">
          <label className="block text-sm font-medium">
            {chosen === "request_changes" ? "What should the creator change?" : "Reason (sent to the creator)"}
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              maxLength={2000}
              className="mt-1 block w-full rounded-md border border-navy-900/20 bg-white px-3 py-2"
              autoFocus
            />
          </label>
          <div className="flex gap-2">
            <Button size="sm" disabled={pending || !notes.trim()} onClick={() => submit(chosen)}>
              {LABELS[chosen]}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setChosen(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      <ErrorText error={error} />
    </div>
  );
}

export function BulkApproveButton({ videoIds }: { videoIds: string[] }) {
  const { pending, error, run } = useAdminAction();
  if (videoIds.length === 0) return null;
  return (
    <span>
      <Button size="sm" disabled={pending} onClick={() => run("/api/admin/moderation/bulk-approve", "POST", { videoIds })}>
        {pending ? "Approving..." : `Approve ${videoIds.length} AI-recommended`}
      </Button>
      <ErrorText error={error} />
    </span>
  );
}

export function RescreenButton({ videoId }: { videoId: string }) {
  const { pending, error, run } = useAdminAction();
  return (
    <span>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(`/api/admin/moderation/${videoId}/rescreen`, "POST")}>
        {pending ? "Screening..." : "Re-run AI screen"}
      </Button>
      <ErrorText error={error} />
    </span>
  );
}

export function ResolveReportsButtons({ videoId }: { videoId: string }) {
  const { pending, error, run } = useAdminAction();
  const url = `/api/admin/moderation/${videoId}/reports`;
  return (
    <span className="inline-flex flex-wrap gap-2">
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(url, "POST", { outcome: "dismissed" })}>
        Dismiss reports
      </Button>
      <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(url, "POST", { outcome: "actioned" })}>
        Mark reports actioned
      </Button>
      <ErrorText error={error} />
    </span>
  );
}
