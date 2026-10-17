import { NextResponse } from "next/server";
import { z } from "zod";
import { createCourse } from "@/lib/courses/admin";
import { getDb } from "@/lib/db";
import { asAdmin, readJson } from "../_shared";

/** Create a draft course. */
export async function POST(request: Request) {
  return asAdmin(async () => {
    const parsed = await readJson(request, z.object({ title: z.string().trim().min(3).max(140) }));
    if (!parsed.success) return NextResponse.json({ error: "invalid_request", message: "Give the course a title." }, { status: 400 });
    return NextResponse.json({ course: await createCourse(getDb(), parsed.data) }, { status: 201 });
  });
}
