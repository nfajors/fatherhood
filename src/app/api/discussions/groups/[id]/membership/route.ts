import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { joinGroup, leaveGroup } from "@/lib/discussions/service";
import { asSignedIn, invalid, uuid } from "../../../_shared";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = uuid.safeParse((await params).id);
  return asSignedIn(async (user) => {
    if (!id.success) return invalid();
    await joinGroup(getDb(), user.id, id.data);
    return NextResponse.json({ joined: true });
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = uuid.safeParse((await params).id);
  return asSignedIn(async (user) => {
    if (!id.success) return invalid();
    await leaveGroup(getDb(), user.id, id.data);
    return NextResponse.json({ left: true });
  });
}
