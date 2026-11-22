import type { Metadata } from "next";
import { Composer } from "@/components/discussions/actions";
import { FeedList } from "@/components/discussions/post-card";
import { DiscussionsShell, discussionViewer, MembersPostNote } from "@/components/discussions/shell";
import { getDb } from "@/lib/db";
import { listFeed, listGroups } from "@/lib/discussions/service";

export const metadata: Metadata = { title: "Discussions", robots: { index: false } };
export const dynamic = "force-dynamic";

const parseBefore = (v?: string) => {
  const d = v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

export default async function DiscussionsPage({ searchParams }: { searchParams: Promise<{ view?: string; before?: string }> }) {
  const { view, before } = await searchParams;
  const following = view === "following";
  const { viewer, canPost, canModerateAny } = await discussionViewer("/discussions");
  const db = getDb();
  const [feed, groups] = await Promise.all([
    listFeed(db, { viewerId: viewer.id, scope: following ? { kind: "following" } : { kind: "all" }, before: parseBefore(before) }),
    listGroups(db, viewer.id),
  ]);
  const joined = groups.filter((g) => g.myRole).map((g) => ({ id: g.id, name: g.name }));
  const base = following ? "/discussions?view=following&" : "/discussions?";
  return (
    <DiscussionsShell active={following ? "/discussions?view=following" : "/discussions"} canModerateAny={canModerateAny}>
      {canPost ? (
        <div className="mb-6 rounded-xl border border-navy-900/10 bg-white p-4">
          <Composer groups={joined} />
          {joined.length === 0 && <p className="mt-2 text-xs text-muted">Join a group to post there too.</p>}
        </div>
      ) : (
        <div className="mb-6">
          <MembersPostNote />
        </div>
      )}
      <FeedList
        posts={feed.posts}
        canReact
        empty={following ? "No posts from people you follow yet. Follow someone from their name on a post." : "No posts yet. Start the conversation."}
        olderHref={feed.nextBefore ? `${base}before=${encodeURIComponent(feed.nextBefore.toISOString())}` : null}
      />
    </DiscussionsShell>
  );
}
