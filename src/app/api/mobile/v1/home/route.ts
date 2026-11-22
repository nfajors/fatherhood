import { homeView } from "@/lib/mobile/api";
import { asAppUser, json } from "../_shared";

export const dynamic = "force-dynamic";

/** Continue watching, courses in progress, the coach's next step and trending stories. */
export async function GET() {
  return asAppUser(async ({ db, user }) => json(await homeView(db, user.id)));
}
