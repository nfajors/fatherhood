import Link from "next/link";
import type { SessionUser } from "@/lib/auth";
import { canComment, COMMENT_POLICY, listComments } from "@/lib/comments/service";
import type { Database } from "@/lib/db";
import { CommentForm, CommentThread } from "./comment-thread";

const ALL = 200;

/** The conversation under a video or lesson. */
export async function CommentsSection({
  db,
  videoId,
  viewer,
  path,
  showAll = false,
}: {
  db: Database;
  videoId: string;
  viewer: SessionUser | null;
  /** This page's path, for "show all" and sign-in return. */
  path: string;
  showAll?: boolean;
}) {
  const [{ threads, total, hasMore }, allowed] = await Promise.all([
    listComments(db, videoId, { viewerId: viewer?.id, limit: showAll ? ALL : COMMENT_POLICY.pageSize }),
    canComment(db, viewer, videoId),
  ]);

  return (
    <section aria-labelledby="comments" className="mt-10 border-t border-navy-900/10 pt-8">
      <h2 id="comments" className="text-xl font-semibold">
        Conversation{total > 0 && <span className="ml-2 text-base font-normal text-muted">({total})</span>}
      </h2>
      <div className="mt-4">
        {allowed ? (
          <CommentForm videoId={videoId} placeholder="Share how this landed for you, or a question for other fathers." maxChars={COMMENT_POLICY.maxChars} />
        ) : !viewer ? (
          <p className="text-sm text-muted">
            <Link href={`/sign-in?next=${encodeURIComponent(path)}`} className="font-medium text-navy-900 underline underline-offset-2">
              Sign in
            </Link>{" "}
            to join the conversation.
          </p>
        ) : (
          <p className="text-sm text-muted">Members can join the conversation on lessons.</p>
        )}
        <p className="mt-2 text-xs text-muted">Be kind and keep it about fathering. Comments show your first name and last initial.</p>
      </div>
      {threads.length === 0 ? (
        <p className="mt-6 text-sm text-muted">No comments yet.</p>
      ) : (
        <ul className="mt-4 divide-y divide-navy-900/10">
          {threads.map((t) => (
            <CommentThread key={t.id} thread={t} videoId={videoId} canComment={allowed} signedIn={Boolean(viewer)} maxChars={COMMENT_POLICY.maxChars} />
          ))}
        </ul>
      )}
      {hasMore && (
        <Link href={`${path}?comments=all#comments`} scroll={false} className="mt-3 inline-block text-sm font-semibold underline-offset-2 hover:underline">
          Show all comments
        </Link>
      )}
    </section>
  );
}
