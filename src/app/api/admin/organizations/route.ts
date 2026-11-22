import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { createOrganization } from "@/lib/organizations/service";
import { orgErrorResponse } from "../../org/_shared";
import { asAdmin, readJson } from "../_shared";
import { orgFields } from "./_fields";

/** Create an organization (our team, for a contract). */
export async function POST(request: Request) {
  return asAdmin(async () => {
    const parsed = await readJson(request, orgFields);
    if (!parsed.success) return NextResponse.json({ error: "invalid", message: parsed.error.issues[0]?.message }, { status: 400 });
    try {
      const org = await createOrganization(getDb(), parsed.data);
      return NextResponse.json({ id: org.id, slug: org.slug });
    } catch (error) {
      return orgErrorResponse(error);
    }
  });
}
