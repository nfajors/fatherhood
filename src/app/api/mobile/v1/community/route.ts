import { z } from "zod";
import { COMMUNITY_SORTS, communityView } from "@/lib/mobile/api";
import { asAppUser, json } from "../_shared";

export const dynamic = "force-dynamic";

const query = z.object({
  sort: z.enum(COMMUNITY_SORTS as [string, ...string[]]).default("newest"),
  theme: z.string().max(80).optional(),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

/** Community Voices, a page at a time; themes come with the first page. */
export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = query.safeParse(params);
  if (!parsed.success) return json({ error: "invalid_request" }, 400);
  return asAppUser(async ({ db }) =>
    json(await communityView(db, { sort: parsed.data.sort as (typeof COMMUNITY_SORTS)[number], themeSlug: parsed.data.theme || undefined, offset: parsed.data.offset })),
  );
}
