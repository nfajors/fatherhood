import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminUser, type SessionUser } from "@/lib/auth";
import { CourseError } from "@/lib/courses/admin";
import { ApplicationError } from "@/lib/creators/applications";
import { ModerationError } from "@/lib/moderation/service";
import { RatingError } from "@/lib/ratings/service";
import { ThemeServiceError } from "@/lib/themes/service";

export const targetSchema = z.object({ kind: z.enum(["video", "course"]), id: z.uuid() });

const MODERATION_STATUS: Record<ModerationError["reason"], number> = {
  not_found: 404,
  invalid_transition: 409,
  notes_required: 400,
  not_reportable: 400,
};

/** Run an admin-only handler: 403 for everyone else; service errors become 4xx with their message. */
export async function asAdmin(handler: (admin: SessionUser) => Promise<Response>): Promise<Response> {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  try {
    return await handler(admin);
  } catch (error) {
    if (error instanceof ThemeServiceError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof CourseError) {
      return NextResponse.json({ error: error.reason, message: error.message }, { status: error.reason === "not_found" ? 404 : 400 });
    }
    if (error instanceof ApplicationError) {
      return NextResponse.json({ error: error.reason, message: error.message }, { status: error.reason === "not_found" || error.reason === "no_account" ? 404 : 409 });
    }
    if (error instanceof RatingError) {
      return NextResponse.json({ error: error.reason, message: error.message }, { status: error.reason === "not_found" ? 404 : 400 });
    }
    if (error instanceof ModerationError) {
      return NextResponse.json({ error: error.reason, message: error.message }, { status: MODERATION_STATUS[error.reason] });
    }
    throw error;
  }
}

export async function readJson<T extends z.ZodType>(request: Request, schema: T) {
  return schema.safeParse(await request.json().catch(() => null));
}
