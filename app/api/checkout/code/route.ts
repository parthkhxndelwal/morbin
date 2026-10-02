import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { CHECKOUT_COOKIE, RESUME_TTL_MS, consumeOtpCode, getSessionByResumeToken, setResumeToken } from "@/lib/checkout";
import { clientIp, rateLimit } from "@/lib/rate-limit";

/**
 * POST { code } — confirm the email with the 6-digit code from the same email
 * as the magic link, without leaving the drawer. Bound to the drawer's own
 * session (the cookie); wrong codes count towards the link's attempt limit.
 */
export async function POST(request: Request) {
  const jar = await cookies();
  const session = await getSessionByResumeToken(jar.get(CHECKOUT_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: "Your checkout expired. Please start again." }, { status: 404 });
  if (!(await rateLimit("otp-code:ip", await clientIp(), 30, 10 * 60 * 1000))) {
    return NextResponse.json({ error: "Too many attempts. Wait a few minutes and try again." }, { status: 429 });
  }
  const body = (await request.json().catch(() => ({}))) as { code?: unknown };
  const result = await consumeOtpCode(session.publicId, typeof body.code === "string" ? body.code : "");
  if (!result.ok) {
    const error =
      result.reason === "expired"
        ? "That code has expired. Send a new one."
        : result.reason === "attempts"
          ? "Too many wrong codes. Send a new one."
          : "That code isn't right. Check the email and try again.";
    return NextResponse.json({ error, reason: result.reason }, { status: 400 });
  }
  const resume = await setResumeToken(result.session.publicId, { userId: result.session.identity.userId });
  jar.set(CHECKOUT_COOKIE, resume, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(RESUME_TTL_MS / 1000),
  });
  return NextResponse.json({ ok: true });
}
