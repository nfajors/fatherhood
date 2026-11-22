import { NextResponse } from "next/server";
import { z } from "zod";
import { REGION_COOKIE } from "@/lib/region-server";
import { REGIONS, type RegionCode } from "@/lib/regions";

const body = z.object({ code: z.enum(Object.keys(REGIONS) as [RegionCode, ...RegionCode[]]) });

/** Remember the visitor's chosen country for prices and dates. */
export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const res = NextResponse.json({ code: parsed.data.code });
  res.cookies.set(REGION_COOKIE, parsed.data.code, {
    path: "/",
    maxAge: 365 * 24 * 3600,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
  });
  return res;
}
