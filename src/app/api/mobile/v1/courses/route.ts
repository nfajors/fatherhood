import { coursesView } from "@/lib/mobile/api";
import { asAppUser, json } from "../_shared";

export const dynamic = "force-dynamic";

/** The Academy: published courses with his progress. */
export async function GET() {
  return asAppUser(async ({ db, user }) => json(await coursesView(db, user.id)));
}
