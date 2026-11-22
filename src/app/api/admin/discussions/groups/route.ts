import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { createGroup, DiscussionError } from "@/lib/discussions/service";
import { asAdmin, readJson } from "../../_shared";

const body = z.object({ name: z.string().max(80), description: z.string().max(300) });

export async function POST(request: Request) {
  return asAdmin(async () => {
    const parsed = await readJson(request, body);
    if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
    try {
      const group = await createGroup(getDb(), parsed.data);
      return NextResponse.json({ id: group.id, slug: group.slug });
    } catch (error) {
      if (error instanceof DiscussionError) return NextResponse.json({ error: error.reason, message: error.message }, { status: 400 });
      throw error;
    }
  });
}
