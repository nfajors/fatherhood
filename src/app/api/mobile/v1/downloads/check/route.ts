import { z } from "zod";
import { checkLicenses } from "@/lib/mobile/downloads";
import { asAppUser, json } from "../../_shared";

export const dynamic = "force-dynamic";

const body = z.object({ videoIds: z.array(z.uuid()).max(200) });

/** Renew the licenses of the videos on his phone, or revoke them (the app then deletes the files). */
export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid_request" }, 400);
  return asAppUser(async ({ db, viewer }) => json({ licenses: await checkLicenses(db, { viewer, videoIds: parsed.data.videoIds }) }));
}
