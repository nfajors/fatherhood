import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { updateOrganization } from "@/lib/organizations/service";
import { orgErrorResponse } from "../../../org/_shared";
import { asAdmin, readJson } from "../../_shared";
import { orgFields } from "../_fields";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return asAdmin(async () => {
    const id = z.uuid().safeParse((await params).id);
    if (!id.success) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const parsed = await readJson(request, orgFields);
    if (!parsed.success) return NextResponse.json({ error: "invalid", message: parsed.error.issues[0]?.message }, { status: 400 });
    try {
      await updateOrganization(getDb(), id.data, parsed.data);
      return NextResponse.json({ saved: true });
    } catch (error) {
      return orgErrorResponse(error);
    }
  });
}
