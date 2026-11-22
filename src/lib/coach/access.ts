/** Who may use the coach: members (and admins). Needs Anthropic credentials to run at all. */
import type { SessionUser } from "@/lib/auth";
import type { Database } from "@/lib/db";
import { isMember, loadViewer } from "@/lib/playback/access";

export async function canUseCoach(db: Database, sessionUser: SessionUser | null): Promise<boolean> {
  return isMember(await loadViewer(db, sessionUser));
}

export function coachConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}
