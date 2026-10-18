import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { downloadDecision } from "@/lib/courses/resources";
import { getDb } from "@/lib/db";
import { r2FromEnv } from "@/lib/storage/r2";

/**
 * Download a lesson file: an access check, then a redirect to an R2 link that
 * expires in minutes, so links can't be passed around.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const decision = await downloadDecision(getDb(), id, await getSessionUser());
  if (decision.result === "not_found") return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (decision.result === "denied") {
    const to = decision.signedIn ? "/pricing" : `/sign-in?next=${encodeURIComponent(new URL(request.url).pathname)}`;
    return NextResponse.redirect(new URL(to, request.url), 303);
  }
  const url = await (await r2FromEnv()).presignDownload(decision.key, decision.fileName);
  return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "private, no-store" } });
}
