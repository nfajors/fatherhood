"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ErrorText, useApiAction } from "@/components/use-api-action";
import { Button } from "@/components/ui/button";
import { CRISIS_RESOURCES } from "@/lib/coach/policy";
import { DISCUSSION_POLICY } from "@/lib/discussions/policy";
import { REPORT_REASONS } from "@/lib/moderation/policy";

const field = "mt-1 block w-full rounded-md border border-navy-900/20 bg-white px-3 py-2 text-base";

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & { message?: string; error?: string };
  return { ok: res.ok, data, message: data.message ?? data.error ?? (res.ok ? null : `Something went wrong (${res.status}).`) };
}

function HeldNotice({ atRisk }: { atRisk: boolean }) {
  return (
    <div role="status" className="rounded-lg bg-gold-100 px-4 py-3 text-sm">
      <p>Thanks. Your post is waiting for a quick look from our moderators, and will appear once they&apos;ve seen it.</p>
      {atRisk && (
        <div className="mt-3">
          <p className="font-semibold">If you or someone with you might be in danger, please reach out now:</p>
          <ul className="mt-1 space-y-1">
            {CRISIS_RESOURCES.map((r) => (
              <li key={r.name}>
                <strong>{r.name}:</strong> {r.detail}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Write a post (choosing a group from the ones he's joined) or a reply. */
export function Composer({
  parentId,
  groupId,
  groups,
  placeholder = "Share something with other fathers…",
  compact = false,
}: {
  parentId?: string;
  groupId?: string;
  groups?: { id: string; name: string }[];
  placeholder?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [target, setTarget] = useState(groupId ?? "");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [held, setHeld] = useState<{ atRisk: boolean } | null>(null);
  const max = parentId ? DISCUSSION_POLICY.maxReplyChars : DISCUSSION_POLICY.maxPostChars;
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        setHeld(null);
        start(async () => {
          const res = await send("/api/discussions/posts", "POST", { body, parentId: parentId ?? null, groupId: parentId ? null : target || null });
          if (!res.ok) return setError(res.message);
          setBody("");
          if (res.data.status === "pending") setHeld({ atRisk: Boolean(res.data.atRisk) });
          router.refresh();
        });
      }}
    >
      <label className="sr-only" htmlFor={parentId ? `reply-${parentId}` : "new-post"}>
        {parentId ? "Your reply" : "Your post"}
      </label>
      <textarea
        id={parentId ? `reply-${parentId}` : "new-post"}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        required
        maxLength={max}
        rows={compact ? 2 : 4}
        placeholder={placeholder}
        className={`${field} resize-y`}
      />
      <div className="flex flex-wrap items-center gap-3">
        {groups && !parentId && !groupId && (
          <label className="text-sm">
            <span className="sr-only">Post in</span>
            <select value={target} onChange={(e) => setTarget(e.target.value)} className="rounded-md border border-navy-900/20 bg-white px-2 py-2 text-sm">
              <option value="">Everyone</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <Button type="submit" size="sm" disabled={pending || body.trim().length < 2}>
          {pending ? "Posting…" : parentId ? "Reply" : "Post"}
        </Button>
        {max - body.length < 200 && <span className="text-xs text-muted">{max - body.length} characters left</span>}
      </div>
      {held && <HeldNotice atRisk={held.atRisk} />}
      <ErrorText error={error} />
    </form>
  );
}

export function MeTooButton({ postId, count, reacted, disabled }: { postId: string; count: number; reacted: boolean; disabled?: boolean }) {
  const [state, setState] = useState({ count, reacted });
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      aria-pressed={state.reacted}
      disabled={disabled || pending}
      onClick={() =>
        start(async () => {
          const res = await send(`/api/discussions/posts/${postId}/reaction`, "POST");
          if (res.ok) setState({ count: res.data.count as number, reacted: res.data.reacted as boolean });
        })
      }
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${state.reacted ? "border-gold-500 bg-gold-100 font-semibold" : "border-navy-900/15 hover:border-gold-500"} disabled:cursor-default disabled:opacity-60`}
    >
      <span aria-hidden>✋</span> Me too{state.count > 0 && <span className="tabular-nums">· {state.count}</span>}
    </button>
  );
}

/** The "…" actions on a post: edit and delete your own, report others', and moderator actions. */
export function PostActions({ postId, isOwn, body, canModerate, status, isReply }: { postId: string; isOwn: boolean; body: string; canModerate: boolean; status: "visible" | "pending" | "hidden"; isReply: boolean }) {
  const router = useRouter();
  const { pending, error, run } = useApiAction();
  const [mode, setMode] = useState<"idle" | "edit" | "report">("idle");
  const [text, setText] = useState(body);
  const [reason, setReason] = useState<keyof typeof REPORT_REASONS>("inappropriate");
  const [done, setDone] = useState<string | null>(null);
  const moderate = (action: string, confirmText?: string) => (!confirmText || window.confirm(confirmText)) && run(`/api/discussions/posts/${postId}/moderate`, "POST", { action });

  return (
    <div className="text-sm">
      <div className="flex flex-wrap gap-1">
        {isOwn && status !== "hidden" && (
          <Button size="sm" variant="ghost" onClick={() => setMode(mode === "edit" ? "idle" : "edit")}>
            Edit
          </Button>
        )}
        {isOwn && (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => window.confirm("Delete this post?") && run(`/api/discussions/posts/${postId}`, "DELETE", undefined, () => !isReply && router.push("/discussions"))}>
            Delete
          </Button>
        )}
        {!isOwn && status === "visible" && (
          <Button size="sm" variant="ghost" onClick={() => setMode(mode === "report" ? "idle" : "report")}>
            Report
          </Button>
        )}
        {canModerate && status === "pending" && (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => moderate("approve")}>
            Approve
          </Button>
        )}
        {canModerate && status === "visible" && !isOwn && (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => moderate("hide", "Hide this post while you review it?")}>
            Hide
          </Button>
        )}
        {canModerate && status === "hidden" && (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => moderate("restore")}>
            Restore
          </Button>
        )}
        {canModerate && !isOwn && (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => moderate("remove", "Remove this post for good?")}>
            Remove
          </Button>
        )}
      </div>
      {mode === "edit" && (
        <form
          className="mt-2 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(`/api/discussions/posts/${postId}`, "PATCH", { body: text }, () => setMode("idle"));
          }}
        >
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={isReply ? DISCUSSION_POLICY.maxReplyChars : DISCUSSION_POLICY.maxPostChars} className={field} aria-label="Edit your post" />
          <Button type="submit" size="sm" disabled={pending}>
            Save
          </Button>
        </form>
      )}
      {mode === "report" && (
        <form
          className="mt-2 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(`/api/discussions/posts/${postId}/report`, "POST", { reason }, () => {
              setMode("idle");
              setDone("Thanks. Our moderators will take a look.");
            });
          }}
        >
          <label className="block">
            Why?
            <select value={reason} onChange={(e) => setReason(e.target.value as keyof typeof REPORT_REASONS)} className={field}>
              {Object.entries(REPORT_REASONS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            Report
          </Button>
        </form>
      )}
      {done && (
        <p role="status" className="mt-1 text-emerald-800">
          {done}
        </p>
      )}
      <ErrorText error={error} />
    </div>
  );
}

export function JoinGroupButton({ groupId, joined }: { groupId: string; joined: boolean }) {
  const { pending, error, run } = useApiAction();
  return (
    <div>
      <Button size="sm" variant={joined ? "outline" : "primary"} disabled={pending} onClick={() => run(`/api/discussions/groups/${groupId}/membership`, joined ? "DELETE" : "POST")}>
        {joined ? "Leave group" : "Join group"}
      </Button>
      <ErrorText error={error} />
    </div>
  );
}

export function FollowButton({ userId, following }: { userId: string; following: boolean }) {
  const { pending, error, run } = useApiAction();
  return (
    <div>
      <Button size="sm" variant={following ? "outline" : "primary"} disabled={pending} onClick={() => run(`/api/discussions/people/${encodeURIComponent(userId)}/follow`, following ? "DELETE" : "POST")}>
        {following ? "Following" : "Follow"}
      </Button>
      <ErrorText error={error} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Admin: groups
// ---------------------------------------------------------------------------

export function StarterGroupsButton() {
  const { pending, error, run } = useApiAction();
  return (
    <div>
      <Button variant="outline" disabled={pending} onClick={() => run("/api/admin/discussions/groups/starter", "POST")}>
        Add starter groups
      </Button>
      <ErrorText error={error} />
    </div>
  );
}

export function NewGroupForm() {
  const { pending, error, run } = useApiAction();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  return (
    <form
      className="grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        run("/api/admin/discussions/groups", "POST", { name, description }, () => {
          setName("");
          setDescription("");
        });
      }}
    >
      <label className="block text-sm font-medium">
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} className={field} placeholder="Stepdads" />
      </label>
      <label className="block text-sm font-medium">
        Description
        <input value={description} onChange={(e) => setDescription(e.target.value)} required maxLength={300} className={field} placeholder="Raising kids you didn't start out raising." />
      </label>
      <Button type="submit" disabled={pending}>
        Add group
      </Button>
      <ErrorText error={error} />
    </form>
  );
}

export function GroupAdminActions({ groupId, status }: { groupId: string; status: "active" | "archived" }) {
  const { pending, error, run } = useApiAction();
  const [email, setEmail] = useState("");
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(`/api/admin/discussions/groups/${groupId}/moderators`, "POST", { email, moderator: true }, () => setEmail(""));
          }}
        >
          <label className="block text-sm">
            Add a moderator
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className={field} placeholder="fellow@example.com" />
          </label>
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            Add
          </Button>
        </form>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(`/api/admin/discussions/groups/${groupId}`, "PATCH", { status: status === "active" ? "archived" : "active" })}>
          {status === "active" ? "Archive" : "Restore"}
        </Button>
      </div>
      <ErrorText error={error} />
    </div>
  );
}

export function RemoveModeratorButton({ groupId, email }: { groupId: string; email: string }) {
  const { pending, run } = useApiAction();
  return (
    <button type="button" className="text-xs underline" disabled={pending} onClick={() => run(`/api/admin/discussions/groups/${groupId}/moderators`, "POST", { email, moderator: false })}>
      remove
    </button>
  );
}
