import Link from "next/link";
import type { PostView } from "@/lib/discussions/service";
import { timeAgo } from "@/lib/discussions/format";
import { MeTooButton, PostActions } from "./actions";

const BADGE = { fellow: "Fellow", team: "Fatherhood.School" } as const;

export function Byline({ post }: { post: PostView }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-sm">
      {post.deleted ? (
        <span className="text-muted">Deleted</span>
      ) : (
        <Link href={`/discussions/people/${encodeURIComponent(post.author.id)}`} className="font-semibold hover:underline">
          {post.author.name}
        </Link>
      )}
      {post.author.badge && <span className="rounded-full bg-gold-100 px-2 py-0.5 text-xs font-semibold text-navy-900">{BADGE[post.author.badge]}</span>}
      {post.group && (
        <Link href={`/discussions/groups/${post.group.slug}`} className="text-muted hover:underline">
          in {post.group.name}
        </Link>
      )}
      <time dateTime={post.createdAt.toISOString()} className="text-muted">
        · {timeAgo(post.createdAt)}
        {post.editedAt && " · edited"}
      </time>
    </p>
  );
}

function StatusNote({ post }: { post: PostView }) {
  if (post.pending) return <p className="mt-2 rounded-md bg-gold-100 px-3 py-1.5 text-xs">Only you can see this: it&apos;s waiting for a moderator.</p>;
  if (post.hidden) return <p className="mt-2 rounded-md bg-navy-100 px-3 py-1.5 text-xs">Hidden while moderators review reports. Only you can see it.</p>;
  return null;
}

/** A post in a feed (link to its thread) or at the top of its thread. Plain text: no links or formatting. */
export function PostCard({ post, linkToThread, canModerate = false, canReact }: { post: PostView; linkToThread: boolean; canModerate?: boolean; canReact: boolean }) {
  const status = post.pending ? "pending" : post.hidden ? "hidden" : "visible";
  return (
    <article className="rounded-xl border border-navy-900/10 bg-white p-4 shadow-sm sm:p-5">
      <Byline post={post} />
      <StatusNote post={post} />
      {post.deleted ? (
        <p className="mt-2 text-muted">This post was deleted.</p>
      ) : (
        <p className="mt-2 whitespace-pre-wrap break-words leading-relaxed">{post.body}</p>
      )}
      {!post.deleted && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <MeTooButton postId={post.id} count={post.meToo} reacted={post.reacted} disabled={!canReact || post.isOwn || status !== "visible"} />
          {linkToThread && (
            <Link href={`/discussions/${post.id}`} className="text-sm text-muted hover:underline">
              {post.replyCount ? `${post.replyCount} ${post.replyCount === 1 ? "reply" : "replies"}` : "Reply"}
            </Link>
          )}
          {!linkToThread && <PostActions postId={post.id} isOwn={post.isOwn} body={post.body} canModerate={canModerate} status={status} isReply={false} />}
        </div>
      )}
    </article>
  );
}

/** A reply under a thread. */
export function ReplyItem({ post, canModerate, canReact }: { post: PostView; canModerate: boolean; canReact: boolean }) {
  const status = post.pending ? "pending" : post.hidden ? "hidden" : "visible";
  return (
    <li className="border-l-2 border-navy-900/10 pl-4">
      <Byline post={post} />
      <StatusNote post={post} />
      <p className="mt-1 whitespace-pre-wrap break-words leading-relaxed">{post.body}</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <MeTooButton postId={post.id} count={post.meToo} reacted={post.reacted} disabled={!canReact || post.isOwn || status !== "visible"} />
        <PostActions postId={post.id} isOwn={post.isOwn} body={post.body} canModerate={canModerate} status={status} isReply />
      </div>
    </li>
  );
}

export function FeedList({ posts, canReact, empty, olderHref }: { posts: PostView[]; canReact: boolean; empty: string; olderHref: string | null }) {
  if (posts.length === 0) return <p className="rounded-xl border border-dashed border-navy-900/20 p-6 text-center text-muted">{empty}</p>;
  return (
    <div className="space-y-4">
      {posts.map((p) => (
        <PostCard key={p.id} post={p} linkToThread canReact={canReact} />
      ))}
      {olderHref && (
        <p className="text-center">
          <Link href={olderHref} className="text-sm font-semibold underline-offset-2 hover:underline">
            Older posts
          </Link>
        </p>
      )}
    </div>
  );
}
