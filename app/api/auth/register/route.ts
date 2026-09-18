import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { appUrl, sendEmail } from "@/lib/email";
import { registerSchema } from "@/lib/validations";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const db = await getDb();
  const email = parsed.data.email.toLowerCase();
  const existing = await db.collection("users").findOne({ email });
  if (existing) {
    return NextResponse.json(
      { error: "An account with this email already exists" },
      { status: 409 },
    );
  }
  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const token = randomBytes(32).toString("hex");
  await db.collection("users").insertOne({
    name: parsed.data.name,
    email,
    passwordHash,
    emailVerified: null,
    image: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await db.collection("verificationTokens").insertOne({
    identifier: email,
    token,
    expires: new Date(Date.now() + 1000 * 60 * 60 * 24),
  });
  const verifyUrl = appUrl(`/verify-email?token=${token}`);
  await sendEmail({
    to: email,
    subject: "Verify your Morbin email",
    html: `<p>Welcome to Morbin.</p><p><a href="${verifyUrl}">Verify your email</a> to finish signing up.</p>`,
  });
  return NextResponse.json({ ok: true }, { status: 201 });
}
