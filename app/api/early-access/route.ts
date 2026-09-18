import { NextResponse } from "next/server";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Early-access signup.
 * If RESEND_API_KEY + RESEND_AUDIENCE_ID are set, the email is added to the
 * Resend audience. Otherwise the signup is logged so no address is silently
 * dropped during development — wire a store before public launch.
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

  const apiKey = process.env.RESEND_API_KEY;
  const audienceId = process.env.RESEND_AUDIENCE_ID;

  if (apiKey && audienceId) {
    const res = await fetch(`https://api.resend.com/audiences/${audienceId}/contacts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email }),
    });
    // Resend returns 409 if the contact already exists — still a success for us.
    if (!res.ok && res.status !== 409) {
      console.error("[early-access] resend error", res.status, await res.text());
      return NextResponse.json(
        { error: "Something went wrong. Please try again." },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true });
  }

  console.info("[early-access] signup (no Resend configured yet)", { email });
  return NextResponse.json({ ok: true });
}
