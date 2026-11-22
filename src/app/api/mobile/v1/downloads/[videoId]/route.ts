import { z } from "zod";
import { releaseDownload, requestDownload } from "@/lib/mobile/downloads";
import { streamDownloadGateway } from "@/lib/mobile/gateway";
import { asAppUser, json } from "../../_shared";

export const dynamic = "force-dynamic";

/**
 * Download a video for offline viewing. Returns "preparing" (ask again in a
 * little while) the first time a video is downloaded, then a signed MP4 link
 * and a 30-day license.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ videoId: string }> }) {
  const id = z.uuid().safeParse((await params).videoId);
  if (!id.success) return json({ error: "not_found" }, 404);
  return asAppUser(async ({ db, viewer }) => {
    const gateway = await streamDownloadGateway();
    if (!gateway) return json({ error: "not_configured", message: "Downloads aren't available right now." }, 503);
    return json(await requestDownload(db, gateway, { viewer, videoId: id.data }));
  });
}

/** He removed the download from his phone. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ videoId: string }> }) {
  const id = z.uuid().safeParse((await params).videoId);
  if (!id.success) return json({ error: "not_found" }, 404);
  return asAppUser(async ({ db, user }) => {
    await releaseDownload(db, user.id, id.data);
    return json({ released: true });
  });
}
