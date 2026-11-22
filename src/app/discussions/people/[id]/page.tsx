import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FollowButton } from "@/components/discussions/actions";
import { FeedList } from "@/components/discussions/post-card";
import { DiscussionsShell, discussionViewer } from "@/components/discussions/shell";
import { getDb } from "@/lib/db";
import { listFeed, personProfile } from "@/lib/discussions/service";

export const metadata: Metadata = { title: "Father", robots: { index: false } };
export const dynamic = "force-dynamic";

const BADGE = { fellow: "Fellow", team: "Fatherhood.School" } as const;

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const id = decodeURIComponent((await params).id);
  const { viewer, canModerateAny } = await discussionViewer(`/discussions/people/${encodeURIComponent(id)}`);
  const db = getDb();
  const profile = await personProfile(db, id, viewer.id);
  if (!profile) notFound();
  const feed = await listFeed(db, { viewerId: viewer.id, scope: { kind: "person", userId: id } });
  return (
    <DiscussionsShell active="" canModerateAny={canModerateAny}>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">
            {profile.name}
            {profile.badge && <span className="ml-3 rounded-full bg-gold-100 px-2 py-0.5 align-middle text-xs font-semibold">{BADGE[profile.badge]}</span>}
          </h2>
          <p className="mt-1 text-sm text-muted">
            {profile.followers} {profile.followers === 1 ? "follower" : "followers"} · following {profile.following}
          </p>
        </div>
        {profile.id !== viewer.id && <FollowButton userId={profile.id} following={profile.isFollowing} />}
      </div>
      <FeedList posts={feed.posts} canReact empty="No posts yet." olderHref={null} />
    </DiscussionsShell>
  );
}
