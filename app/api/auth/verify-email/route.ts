import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";

const schema = z.object({ token: z.string().min(1) });

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Token is required" }, { status: 400 });
  }
  const db = await getDb();
  const record = await db
    .collection("verificationTokens")
    .findOne({ token: parsed.data.token });
  if (!record || record.expires < new Date()) {
    return NextResponse.json(
      { error: "Verification link is invalid or expired" },
      { status: 400 },
    );
  }
  await db
    .collection("users")
    .updateOne({ email: record.identifier }, { $set: { emailVerified: new Date() } });
  await db.collection("verificationTokens").deleteOne({ token: parsed.data.token });
  return NextResponse.json({ ok: true });
}
