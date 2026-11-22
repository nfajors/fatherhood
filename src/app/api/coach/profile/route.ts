import { NextResponse } from "next/server";
import { z } from "zod";
import { saveProfile } from "@/lib/coach/context";
import { COACH_STAGES, type CoachStage } from "@/lib/coach/policy";
import { getDb } from "@/lib/db";
import { readJson } from "../../admin/_shared";
import { asCoachMember } from "../_shared";

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable();

const body = z.object({
  stage: z.enum(Object.keys(COACH_STAGES) as [CoachStage, ...CoachStage[]]),
  children: optional(300),
  goals: optional(1000),
});

/** Save what the member tells the coach about himself. */
export async function PUT(request: Request) {
  return asCoachMember(async (member) => {
    const parsed = await readJson(request, body);
    if (!parsed.success) return NextResponse.json({ error: "invalid", message: parsed.error.issues[0]?.message ?? "Check the form." }, { status: 400 });
    await saveProfile(getDb(), member.id, parsed.data);
    return NextResponse.json({ saved: true });
  });
}
