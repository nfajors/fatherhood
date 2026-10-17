import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { videos } from "@/lib/db/schema";
import { accessFor, loadViewer, playbackSource } from "@/lib/playback/access";
import { streamFromEnv } from "@/lib/stream";

const ERROR_STATUS = { not_published: 404, sign_in_required: 401, membership_required: 403 } as const;

/** Check entitlement and return playback URLs (signed for Professional content). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const db = getDb();
  const video = await db.query.videos.findFirst({ where: eq(videos.id, id) });
  if (!video?.cloudflareUid) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const decision = await accessFor(db, video, await loadViewer(db, await getSessionUser()));
  if (!decision.allowed) return NextResponse.json({ error: decision.reason }, { status: ERROR_STATUS[decision.reason] });

  const source = await playbackSource(video, decision);
  if (!source) return NextResponse.json({ error: "stream_not_configured" }, { status: 503 });
  const { client } = await streamFromEnv();
  return NextResponse.json(
    { urls: client.playbackUrls(source.src), expiresAt: source.expiresAt?.toISOString() ?? null },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
