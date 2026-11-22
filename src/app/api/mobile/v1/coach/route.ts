import { coachConfigured } from "@/lib/coach/access";
import { coachView } from "@/lib/mobile/api";
import { isMember } from "@/lib/playback/access";
import { asAppUser, json } from "../_shared";

export const dynamic = "force-dynamic";

/**
 * The coach screen: his profile, learning path and conversations. Messages are
 * sent to /api/coach/messages, the same streaming endpoint the website uses.
 */
export async function GET() {
  return asAppUser(async ({ db, user, viewer }) => json(await coachView(db, user.id, { member: isMember(viewer), configured: coachConfigured() })));
}
