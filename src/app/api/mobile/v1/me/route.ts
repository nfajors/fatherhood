import { meView } from "@/lib/mobile/api";
import { asAppUser, json } from "../_shared";

export const dynamic = "force-dynamic";

/** Who is signed in, whether he's a member, and the offline rules. */
export async function GET() {
  return asAppUser(async ({ user, viewer }) => json(meView(user, viewer)));
}
