import { NextResponse } from "next/server";
import { getSessionUser, type SessionUser } from "@/lib/auth";
import { getDb, type Database } from "@/lib/db";
import type { Viewer } from "@/lib/entitlements";
import { DownloadError } from "@/lib/mobile/downloads";
import { loadViewer } from "@/lib/playback/access";

export type MobileContext = { db: Database; user: SessionUser; viewer: Viewer };

const DOWNLOAD_STATUS: Record<DownloadError["reason"], number> = {
  not_found: 404,
  membership_required: 403,
  not_available: 409,
  limit_reached: 409,
  failed: 502,
};

/** JSON that's never cached: everything here is per person. */
export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

/**
 * Run a handler for a signed-in app user (the app sends "Authorization: Bearer <token>").
 * Download errors become 4xx with a message the app shows as is.
 */
export async function asAppUser(handler: (ctx: MobileContext) => Promise<Response>): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ error: "sign_in_required", message: "Please sign in again." }, 401);
  const db = getDb();
  try {
    return await handler({ db, user, viewer: await loadViewer(db, user) });
  } catch (error) {
    if (error instanceof DownloadError) return json({ error: error.reason, message: error.message }, DOWNLOAD_STATUS[error.reason]);
    throw error;
  }
}
