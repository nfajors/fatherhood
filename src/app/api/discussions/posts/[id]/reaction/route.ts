import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { toggleReaction } from "@/lib/discussions/service";
import { asSignedIn, invalid, uuid } from "../../../_shared";

/** "Me too", on or off. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = uuid.safeParse((await params).id);
  return asSignedIn(async (user) => {
    if (!id.success) return invalid();
    return NextResponse.json(await toggleReaction(getDb(), user.id, id.data));
  });
}
