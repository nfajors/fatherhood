import { z } from "zod";
import { syncOfflineProgress } from "@/lib/mobile/downloads";
import { MOBILE_POLICY } from "@/lib/mobile/policy";
import { asAppUser, json } from "../_shared";

export const dynamic = "force-dynamic";

const body = z.object({
  items: z
    .array(
      z.object({
        videoId: z.uuid(),
        positionSeconds: z.number().min(0).max(24 * 3600),
        completed: z.boolean(),
        recordedAt: z.iso.datetime({ offset: true }),
      }),
    )
    .max(MOBILE_POLICY.maxProgressSync),
});

/** Where he got to while watching offline. Saves his place only; views count when streaming. */
export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid_request" }, 400);
  return asAppUser(async ({ db, user }) =>
    json({ saved: await syncOfflineProgress(db, user.id, parsed.data.items.map((i) => ({ ...i, recordedAt: new Date(i.recordedAt) }))) }),
  );
}
