import { eq } from "drizzle-orm";
import { after, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { certifyInBackground } from "@/lib/learning/runtime";
import { videos } from "@/lib/db/schema";
import { accessFor, loadViewer } from "@/lib/playback/access";
import { PlaybackError, recordHeartbeat, setCompleted } from "@/lib/playback/service";

const heartbeat = z.object({
  sessionId: z.uuid().nullable(),
  position: z.number().min(0).max(24 * 3600),
  watched: z.number().min(0).max(3600),
  ended: z.boolean().default(false),
});

/**
 * Player heartbeat: extends the watch session (views, creator pool) and saves
 * resume position for signed-in viewers. Accepts sendBeacon's text/plain body,
 * so the last heartbeat survives the tab closing.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = heartbeat.safeParse(await request.text().then((t) => JSON.parse(t)).catch(() => null));
  if (!z.uuid().safeParse(id).success || !parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const db = getDb();
  const video = await db.query.videos.findFirst({ where: eq(videos.id, id) });
  if (!video) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const sessionUser = await getSessionUser();
  const decision = await accessFor(db, video, await loadViewer(db, sessionUser));
  if (!decision.allowed) return NextResponse.json({ error: decision.reason }, { status: 403 });

  try {
    const result = await recordHeartbeat(db, {
      videoId: id,
      userId: sessionUser?.id ?? null,
      sessionId: parsed.data.sessionId,
      positionSeconds: parsed.data.position,
      watchedSeconds: parsed.data.watched,
      ended: parsed.data.ended,
    });
    if (result.completed && sessionUser) after(() => certifyInBackground(sessionUser.id, id));
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PlaybackError) return NextResponse.json({ error: error.reason }, { status: 409 });
    throw error;
  }
}

/** "Mark complete" / "Mark not complete" for signed-in viewers. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return NextResponse.json({ error: "sign_in_required" }, { status: 401 });
  const { id } = await params;
  const parsed = z.object({ completed: z.boolean() }).safeParse(await request.json().catch(() => null));
  if (!z.uuid().safeParse(id).success || !parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const db = getDb();
  const video = await db.query.videos.findFirst({ where: eq(videos.id, id) });
  if (!video) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const decision = await accessFor(db, video, await loadViewer(db, sessionUser));
  if (!decision.allowed) return NextResponse.json({ error: decision.reason }, { status: 403 });
  await setCompleted(db, sessionUser.id, id, parsed.data.completed);
  if (parsed.data.completed) after(() => certifyInBackground(sessionUser.id, id));
  return NextResponse.json({ completed: parsed.data.completed });
}
