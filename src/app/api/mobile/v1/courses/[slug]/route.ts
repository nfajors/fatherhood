import { courseView } from "@/lib/mobile/api";
import { isMember } from "@/lib/playback/access";
import { asAppUser, json } from "../../_shared";

export const dynamic = "force-dynamic";

/** A course's outline with his progress. Lessons he can't play yet still list (marked for members). */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return asAppUser(async ({ db, user, viewer }) => {
    const view = await courseView(db, slug, user.id, isMember(viewer));
    return view ? json(view) : json({ error: "not_found" }, 404);
  });
}
