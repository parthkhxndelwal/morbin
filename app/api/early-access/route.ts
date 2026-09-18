import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Early-access signup. Stores the address in the `waitlist` collection
 * (unique per email) and returns success. Confirmation emails are sent
 * at launch from this list — nothing is sent at signup time.
 */
export async function POST(request: Request) {
  let email = "";
  try {
    const body = await request.json();
    email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (!EMAIL_RE.test(email) || email.length > 254) {
    return NextResponse.json(
      { error: "Please enter a valid email address." },
      { status: 400 },
    );
  }

  const db = await getDb();
  try {
    await db.collection("waitlist").createIndex({ email: 1 }, { unique: true });
    await db.collection("waitlist").insertOne({
      email,
      source: "landing",
      createdAt: new Date(),
    });
  } catch (error) {
    // Duplicate email (code 11000) still counts as success for the user.
    if (!(error instanceof Error && "code" in error && error.code === 11000)) {
      console.error("[early-access] store failed", error);
      return NextResponse.json(
        { error: "Something went wrong. Please try again." },
        { status: 500 },
      );
    }
  }
  return NextResponse.json({ ok: true });
}
