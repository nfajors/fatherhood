import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Composer } from "@/components/discussions/actions";
import { PostCard, ReplyItem } from "@/components/discussions/post-card";
import { DiscussionsShell, discussionViewer, MembersPostNote } from "@/components/discussions/shell";
import { getDb } from "@/lib/db";
import { getThread } from "@/lib/discussions/service";

export const metadata: Metadata = { title: "Discussion", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { viewer, canPost, canModerateAny } = await discussionViewer(`/discussions/${id}`);
  const postId = z.uuid().safeParse(id);
  const thread = postId.success ? await getThread(getDb(), postId.data, viewer) : null;
  if (!thread) notFound();
  const open = !thread.post.deleted && !thread.post.pending && !thread.post.hidden;
  return (
    <DiscussionsShell active="" canModerateAny={canModerateAny}>
      <p className="mb-4 text-sm">
        <Link href={thread.post.group ? `/discussions/groups/${thread.post.group.slug}` : "/discussions"} className="underline-offset-2 hover:underline">
          ← {thread.post.group ? thread.post.group.name : "All discussions"}
        </Link>
      </p>
      <PostCard post={thread.post} linkToThread={false} canModerate={thread.canModerate} canReact />
      <section aria-labelledby="replies" className="mt-8">
        <h2 id="replies" className="text-lg font-semibold">
          {thread.replies.length ? `${thread.replies.length} ${thread.replies.length === 1 ? "reply" : "replies"}` : "Replies"}
        </h2>
        {thread.replies.length > 0 && (
          <ul className="mt-4 space-y-5">
            {thread.replies.map((r) => (
              <ReplyItem key={r.id} post={r} canModerate={thread.canModerate} canReact />
            ))}
          </ul>
        )}
        <div className="mt-6">
          {!open ? null : canPost ? <Composer parentId={thread.post.id} placeholder="Write a reply…" compact /> : <MembersPostNote />}
        </div>
      </section>
    </DiscussionsShell>
  );
}
