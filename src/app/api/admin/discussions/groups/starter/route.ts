import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { addStarterGroups } from "@/lib/discussions/service";
import { asAdmin } from "../../../_shared";

/** Add the suggested groups (Expecting, New dads, Co-parenting...); existing ones are left alone. */
export async function POST() {
  return asAdmin(async () => NextResponse.json({ added: await addStarterGroups(getDb()) }));
}
