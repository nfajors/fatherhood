import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser, type SessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getOrganization, isManagerOf, OrgError, type Organization } from "@/lib/organizations/service";

const STATUS: Record<OrgError["reason"], number> = {
  not_found: 404,
  invalid: 400,
  no_seats: 409,
  not_active: 409,
  expired: 410,
  used: 410,
  not_allowed: 409,
  already_member: 409,
};

/** Organization errors as 4xx JSON with their message. */
export function orgErrorResponse(error: unknown): Response {
  if (error instanceof OrgError) return NextResponse.json({ error: error.reason, message: error.message }, { status: STATUS[error.reason] });
  throw error;
}

/** Run a handler for one of the organization's managers, or our admins. */
export async function asOrgManager(orgIdParam: string, handler: (ctx: { user: SessionUser; org: Organization }) => Promise<Response>): Promise<Response> {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return NextResponse.json({ error: "sign_in_required" }, { status: 401 });
  const orgId = z.uuid().safeParse(orgIdParam);
  const db = getDb();
  const org = orgId.success ? await getOrganization(db, { id: orgId.data }) : null;
  if (!org) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (sessionUser.role !== "admin" && !(await isManagerOf(db, sessionUser.id, org.id))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  try {
    return await handler({ user: sessionUser, org });
  } catch (error) {
    return orgErrorResponse(error);
  }
}

/** Run a handler for a signed-in person (joining, sharing, leaving). */
export async function asSignedIn(handler: (user: SessionUser) => Promise<Response>): Promise<Response> {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return NextResponse.json({ error: "sign_in_required", message: "Sign in first." }, { status: 401 });
  try {
    return await handler(sessionUser);
  } catch (error) {
    return orgErrorResponse(error);
  }
}
