import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Composer, JoinGroupButton } from "@/components/discussions/actions";
import { FeedList } from "@/components/discussions/post-card";
import { DiscussionsShell, discussionViewer, MembersPostNote } from "@/components/discussions/shell";
import { getDb } from "@/lib/db";
import { getGroup, listFeed, listGroups } from "@/lib/discussions/service";

export const metadata: Metadata = { title: "Group", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function GroupPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ before?: string }> }) {
  const [{ slug }, { before }] = await Promise.all([params, searchParams]);
  const { viewer, canPost, canModerateAny } = await discussionViewer(`/discussions/groups/${slug}`);
  const db = getDb();
  const group = await getGroup(db, slug);
  if (!group || group.status !== "active") notFound();
  const beforeDate = before ? new Date(before) : null;
  const [feed, groups] = await Promise.all([
    listFeed(db, { viewerId: viewer.id, scope: { kind: "group", groupId: group.id }, before: beforeDate && !Number.isNaN(beforeDate.getTime()) ? beforeDate : null }),
    listGroups(db, viewer.id),
  ]);
  const mine = groups.find((g) => g.id === group.id);
  const joined = Boolean(mine?.myRole);
  return (
    <DiscussionsShell active="/discussions/groups" canModerateAny={canModerateAny}>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">{group.name}</h2>
          <p className="mt-1 text-muted">{group.description}</p>
          <p className="mt-1 text-xs text-muted">{mine?.memberCount ?? 0} members</p>
        </div>
        <JoinGroupButton groupId={group.id} joined={joined} />
      </div>
      {canPost ? (
        joined ? (
          <div className="mb-6 rounded-xl border border-navy-900/10 bg-white p-4">
            <Composer groupId={group.id} placeholder={`Share something with ${group.name}…`} />
          </div>
        ) : (
          <p className="mb-6 text-sm text-muted">Join the group to post in it.</p>
        )
      ) : (
        <div className="mb-6">
          <MembersPostNote />
        </div>
      )}
      <FeedList
        posts={feed.posts}
        canReact
        empty="No posts in this group yet."
        olderHref={feed.nextBefore ? `/discussions/groups/${group.slug}?before=${encodeURIComponent(feed.nextBefore.toISOString())}` : null}
      />
    </DiscussionsShell>
  );
}
