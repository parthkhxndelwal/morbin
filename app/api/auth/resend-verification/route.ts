import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { appUrl, sendEmail } from "@/lib/email";

const schema = z.object({ email: z.string().email() });

/**
 * Re-issue an email verification link. Always returns ok to avoid
 * account enumeration; only unverified users actually get an email.
 */
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: true });
  const email = parsed.data.email.toLowerCase();
  const db = await getDb();
  const user = await db.collection("users").findOne({ email });
  if (!user || user.emailVerified) return NextResponse.json({ ok: true });

  await db.collection("verificationTokens").deleteMany({ identifier: email });
  const token = randomBytes(32).toString("hex");
  await db.collection("verificationTokens").insertOne({
    identifier: email,
    token,
    expires: new Date(Date.now() + 1000 * 60 * 60 * 24),
  });
  const verifyUrl = appUrl(`/verify-email?token=${token}`);
  await sendEmail({
    to: email,
    subject: "Verify your Morbin email",
    html: `<p>Here is a fresh verification link (valid 24h).</p><p><a href="${verifyUrl}">Verify your email</a></p>`,
  });
  return NextResponse.json({ ok: true });
}
