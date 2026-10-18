"use client";

import { useState, type FormEvent } from "react";
import { ErrorText, useApiAction } from "@/components/use-api-action";
import { Button } from "@/components/ui/button";
import type { CommentView } from "@/lib/comments/service";
import { REPORT_REASONS, type ReportReason } from "@/lib/moderation/policy";
import { cn } from "@/lib/utils";

const field = "block w-full rounded-md border border-navy-900/20 bg-white px-3 py-2 text-sm";

function timeAgo(date: Date): string {
  const seconds = Math.max(0, (Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const units: [number, string][] = [
    [60 * 60 * 24 * 365, "year"],
    [60 * 60 * 24 * 30, "month"],
    [60 * 60 * 24 * 7, "week"],
    [60 * 60 * 24, "day"],
    [60 * 60, "hour"],
    [60, "minute"],
  ];
  const [size, unit] = units.find(([s]) => seconds >= s)!;
  const n = Math.floor(seconds / size);
  return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
}

/** Compose a comment or a reply. */
export function CommentForm({
  videoId,
  parentId,
  placeholder,
  maxChars,
  onDone,
  autoFocus,
}: {
  videoId: string;
  parentId?: string;
  placeholder: string;
  maxChars: number;
  onDone?: () => void;
  autoFocus?: boolean;
}) {
  const { pending, error, run } = useApiAction();
  const [body, setBody] = useState("");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    run(`/api/videos/${videoId}/comments`, "POST", { body, parentId: parentId ?? null }, () => {
      setBody("");
      onDone?.();
    });
  }
  return (
    <form onSubmit={submit} className="space-y-2">
      <label className="sr-only" htmlFor={`comment-${parentId ?? "new"}`}>
        {parentId ? "Reply" : "Comment"}
      </label>
      <textarea
        id={`comment-${parentId ?? "new"}`}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={parentId ? 2 : 3}
        maxLength={maxChars}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={field}
      />
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending || body.trim().length < 2}>
          {parentId ? "Reply" : "Post comment"}
        </Button>
        {onDone && (
          <Button type="button" size="sm" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        )}
        {body.length > maxChars * 0.9 && <span className="text-xs text-muted tabular-nums">{maxChars - body.length} left</span>}
      </div>
      <ErrorText error={error} />
    </form>
  );
}

function ReportForm({ commentId, onDone }: { commentId: string; onDone: (sent: boolean) => void }) {
  const [state, setState] = useState<"idle" | "sending" | "error">("idle");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("sending");
    const res = await fetch(`/api/comments/${commentId}/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: new FormData(event.currentTarget).get("reason") }),
    });
    if (res.ok) onDone(true);
    else setState("error");
  }
  return (
    <form onSubmit={submit} className="mt-2 space-y-2 rounded-md border border-navy-900/10 bg-paper p-3 text-sm">
      <fieldset>
        <legend className="font-semibold">What&apos;s wrong with this comment?</legend>
        <div className="mt-1 space-y-1">
          {(Object.entries(REPORT_REASONS) as [ReportReason, string][]).map(([value, label], i) => (
            <label key={value} className="flex items-center gap-2">
              <input type="radio" name="reason" value={value} required defaultChecked={i === 0} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="outline" disabled={state === "sending"}>
          Report
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => onDone(false)}>
          Cancel
        </Button>
      </div>
      {state === "error" && (
        <p role="alert" className="text-red-700">
          The report didn&apos;t go through. Please try again.
        </p>
      )}
    </form>
  );
}

function Comment({
  comment,
  videoId,
  canComment,
  signedIn,
  maxChars,
  isReply,
}: {
  comment: CommentView;
  videoId: string;
  canComment: boolean;
  signedIn: boolean;
  maxChars: number;
  isReply?: boolean;
}) {
  const { pending, error, run } = useApiAction();
  const [mode, setMode] = useState<"view" | "reply" | "edit" | "report" | "reported">("view");
  const [draft, setDraft] = useState(comment.body);

  if (comment.deleted) {
    return <p className="py-2 text-sm italic text-muted">This comment was deleted.</p>;
  }

  return (
    <div className={cn("py-3", comment.underReview && "opacity-70")}>
      <p className="flex flex-wrap items-center gap-x-2 text-sm">
        <span className="font-semibold">{comment.author}</span>
        {comment.badge === "creator" && <span className="rounded bg-gold-100 px-1.5 text-xs font-semibold text-gold-600">Creator</span>}
        {comment.badge === "team" && <span className="rounded bg-navy-100 px-1.5 text-xs font-semibold text-navy-900">Fatherhood.School</span>}
        <span className="text-xs text-muted">
          <time dateTime={new Date(comment.createdAt).toISOString()} suppressHydrationWarning>
            {timeAgo(comment.createdAt)}
          </time>
          {comment.editedAt && " · edited"}
        </span>
      </p>
      {mode === "edit" ? (
        <form
          className="mt-2 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(`/api/comments/${comment.id}`, "PATCH", { body: draft }, () => setMode("view"));
          }}
        >
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} maxLength={maxChars} aria-label="Edit comment" className={field} />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              Save
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setMode("view")}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <p className="mt-1 whitespace-pre-line break-words text-sm">{comment.body}</p>
      )}
      {comment.underReview && <p className="mt-1 text-xs text-amber-800">Hidden while our moderators take a look. Only you can see it.</p>}

      {mode === "view" && (
        <div className="mt-1 flex flex-wrap gap-3 text-xs font-medium text-muted">
          {canComment && !comment.underReview && (
            <button type="button" className="hover:text-navy-900" onClick={() => setMode("reply")}>
              Reply
            </button>
          )}
          {comment.isOwn && !comment.underReview && (
            <button type="button" className="hover:text-navy-900" onClick={() => setMode("edit")}>
              Edit
            </button>
          )}
          {comment.isOwn && (
            <button
              type="button"
              className="hover:text-navy-900"
              disabled={pending}
              onClick={() => {
                if (window.confirm("Delete your comment?")) run(`/api/comments/${comment.id}`, "DELETE");
              }}
            >
              Delete
            </button>
          )}
          {!comment.isOwn && signedIn && (
            <button type="button" className="hover:text-navy-900" onClick={() => setMode("report")}>
              Report
            </button>
          )}
        </div>
      )}
      {mode === "reported" && <p className="mt-1 text-xs text-muted">Thanks. Our moderators will take a look.</p>}
      {mode === "report" && <ReportForm commentId={comment.id} onDone={(sent) => setMode(sent ? "reported" : "view")} />}
      {mode === "reply" && (
        <div className={cn("mt-2", isReply ? "" : "pl-4")}>
          <CommentForm videoId={videoId} parentId={comment.id} placeholder={`Reply to ${comment.author}`} maxChars={maxChars} onDone={() => setMode("view")} autoFocus />
        </div>
      )}
      <ErrorText error={error} />
    </div>
  );
}

/** A thread: the comment and its replies, indented. */
export function CommentThread(props: { thread: CommentView; videoId: string; canComment: boolean; signedIn: boolean; maxChars: number }) {
  const { thread, ...rest } = props;
  return (
    <li>
      <Comment comment={thread} {...rest} />
      {thread.replies.length > 0 && (
        <ul className="ml-4 border-l-2 border-navy-900/10 pl-4">
          {thread.replies.map((r) => (
            <li key={r.id}>
              <Comment comment={r} {...rest} isReply />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
