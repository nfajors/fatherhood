import { NextResponse } from "next/server";
import { getProfile } from "@/lib/coach/context";
import { ClaudePathPlanner, generatePath } from "@/lib/coach/path";
import { getDb } from "@/lib/db";
import { asCoachMember } from "../_shared";

export const dynamic = "force-dynamic";

let planner: ClaudePathPlanner | undefined;

/** Plan (or re-plan) the member's learning path from his profile. */
export async function POST() {
  return asCoachMember(async (member) => {
    const db = getDb();
    const profile = await getProfile(db, member.id);
    if (!profile) return NextResponse.json({ error: "profile_required", message: "Tell the coach about yourself first." }, { status: 400 });
    planner ??= new ClaudePathPlanner();
    const path = await generatePath(db, planner, member.id, { stage: profile.stage, children: profile.children, goals: profile.goals });
    return NextResponse.json({ steps: path.steps.length });
  });
}
