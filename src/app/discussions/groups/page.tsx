import type { Metadata } from "next";
import Link from "next/link";
import { JoinGroupButton } from "@/components/discussions/actions";
import { DiscussionsShell, discussionViewer } from "@/components/discussions/shell";
import { getDb } from "@/lib/db";
import { listGroups } from "@/lib/discussions/service";

export const metadata: Metadata = { title: "Groups", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function GroupsPage() {
  const { viewer, canModerateAny } = await discussionViewer("/discussions/groups");
  const groups = await listGroups(getDb(), viewer.id);
  return (
    <DiscussionsShell active="/discussions/groups" canModerateAny={canModerateAny}>
      <p className="text-muted">Groups for where you are as a father. Join one to post in it; anyone can read.</p>
      {groups.length === 0 ? (
        <p className="mt-6 text-muted">No groups yet.</p>
      ) : (
        <ul className="mt-6 space-y-3">
          {groups.map((g) => (
            <li key={g.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-navy-900/10 bg-white p-4">
              <div className="min-w-0">
                <Link href={`/discussions/groups/${g.slug}`} className="font-semibold hover:underline">
                  {g.name}
                </Link>
                {g.myRole === "moderator" && <span className="ml-2 text-xs text-muted">You moderate this group</span>}
                <p className="text-sm text-muted">{g.description}</p>
                <p className="mt-1 text-xs text-muted">
                  {g.memberCount} {g.memberCount === 1 ? "member" : "members"} · {g.postCount} {g.postCount === 1 ? "post" : "posts"}
                </p>
              </div>
              <JoinGroupButton groupId={g.id} joined={Boolean(g.myRole)} />
            </li>
          ))}
        </ul>
      )}
    </DiscussionsShell>
  );
}
