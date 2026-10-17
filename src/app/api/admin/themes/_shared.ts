import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminUser } from "@/lib/auth";
import { ThemeServiceError } from "@/lib/themes/service";

export const targetSchema = z.object({ kind: z.enum(["video", "course"]), id: z.uuid() });

/** Run an admin-only handler, mapping service errors to 400 and non-admins to 403. */
export async function asAdmin(handler: () => Promise<Response>): Promise<Response> {
  if (!(await getAdminUser())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  try {
    return await handler();
  } catch (error) {
    if (error instanceof ThemeServiceError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

export async function readJson<T extends z.ZodType>(request: Request, schema: T) {
  return schema.safeParse(await request.json().catch(() => null));
}
