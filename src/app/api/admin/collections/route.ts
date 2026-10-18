import { NextResponse } from "next/server";
import { z } from "zod";
import { createCollection } from "@/lib/collections/service";
import { getDb } from "@/lib/db";
import { asAdmin, readJson } from "../_shared";

/** Create a draft collection. */
export async function POST(request: Request) {
  return asAdmin(async () => {
    const parsed = await readJson(request, z.object({ title: z.string().trim().min(2).max(120) }));
    if (!parsed.success) return NextResponse.json({ error: "invalid_request", message: "Give the collection a title." }, { status: 400 });
    return NextResponse.json({ collection: await createCollection(getDb(), parsed.data.title) }, { status: 201 });
  });
}
