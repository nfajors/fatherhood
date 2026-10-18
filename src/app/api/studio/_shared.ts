import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser, type SessionUser } from "@/lib/auth";
import { StudioError } from "@/lib/creators/videos";

const STATUS: Record<StudioError["reason"], number> = {
  not_found: 404,
  forbidden: 403,
  not_allowed_now: 409,
  too_large: 413,
};

/** Run a Studio handler for a Fellow or admin; service errors become 4xx with their message. */
export async function asCreator(handler: (creator: SessionUser) => Promise<Response>): Promise<Response> {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return NextResponse.json({ error: "sign_in_required" }, { status: 401 });
  if (sessionUser.role === "user") return NextResponse.json({ error: "forbidden", message: "Uploading is for Fellows." }, { status: 403 });
  try {
    return await handler(sessionUser);
  } catch (error) {
    if (error instanceof StudioError) return NextResponse.json({ error: error.reason, message: error.message }, { status: STATUS[error.reason] });
    throw error;
  }
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable();

/** Title, description, category and tags, as creators edit them. */
export const videoDetails = z.object({
  title: z.string().trim().min(3, "Give the video a title of at least 3 characters.").max(140),
  description: optionalText(5000),
  category: z.string().trim().max(60).nullable(),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(10),
});

export const videoId = z.uuid();
