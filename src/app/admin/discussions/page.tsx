import type { Metadata } from "next";
import Link from "next/link";
import { GroupAdminActions, NewGroupForm, RemoveModeratorButton, StarterGroupsButton } from "@/components/discussions/actions";
import { Card } from "@/components/ui/card";
import { getDb } from "@/lib/db";
import { groupModerators, listGroups } from "@/lib/discussions/service";

export const metadata: Metadata = { title: "Discussions (admin)", robots: { index: false } };

export default async function AdminDiscussionsPage() {
  const db = getDb();
  const groups = await listGroups(db, null, { includeArchived: true });
  const moderators = await Promise.all(groups.map((g) => groupModerators(db, g.id)));
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-3xl font-semibold">Discussions</h1>
        <Link href="/discussions/moderate" className="font-semibold underline-offset-2 hover:underline">
          Moderation queue →
        </Link>
      </div>
      <p className="mt-2 max-w-3xl text-muted">
        Members, Fellows and admins post; everyone signed in reads. Every post is checked by AI first: clear posts appear at once, others wait in the queue. Three
        reporters hide a post until someone decides. Group moderators handle their group&apos;s queue.
      </p>

      <section aria-labelledby="groups" className="mt-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="groups" className="text-xl font-semibold">
            Groups
          </h2>
          <StarterGroupsButton />
        </div>
        <Card className="mt-4">
          <NewGroupForm />
        </Card>
        {groups.length > 0 && (
          <ul className="mt-4 space-y-3">
            {groups.map((g, i) => (
              <li key={g.id} className="rounded-xl border border-navy-900/10 bg-white p-4">
                <p className="font-semibold">
                  {g.name}
                  {g.status === "archived" && <span className="ml-2 text-xs font-normal text-muted">Archived</span>}
                  <span className="ml-2 text-xs font-normal text-muted">
                    {g.memberCount} members · {g.postCount} posts
                  </span>
                </p>
                <p className="text-sm text-muted">{g.description}</p>
                <p className="mt-2 text-sm">
                  Moderators:{" "}
                  {moderators[i]!.length === 0
                    ? "none"
                    : moderators[i]!.map((m, j) => (
                        <span key={m.userId}>
                          {j > 0 && ", "}
                          {m.name} ({m.email}) <RemoveModeratorButton groupId={g.id} email={m.email} />
                        </span>
                      ))}
                </p>
                <div className="mt-3">
                  <GroupAdminActions groupId={g.id} status={g.status} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
