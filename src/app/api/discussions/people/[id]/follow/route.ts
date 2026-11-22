import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { follow, unfollow } from "@/lib/discussions/service";
import { asSignedIn, invalid } from "../../../_shared";

const userId = z.string().min(1).max(100);

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = userId.safeParse((await params).id);
  return asSignedIn(async (user) => {
    if (!id.success) return invalid();
    await follow(getDb(), user.id, id.data);
    return NextResponse.json({ following: true });
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = userId.safeParse((await params).id);
  return asSignedIn(async (user) => {
    if (!id.success) return invalid();
    await unfollow(getDb(), user.id, id.data);
    return NextResponse.json({ following: false });
  });
}
