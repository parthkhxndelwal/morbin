import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { auth, signIn, signOut } from "@/lib/auth";
import {
  CHECKOUT_COOKIE,
  CONSENT_REQUIRED,
  RESUME_TTL_MS,
  getSessionByResumeToken,
  setResumeToken,
} from "@/lib/checkout";

/**
 * Turning a completed Google popup into a verified buyer identity.
 *
 * The popup carries the session cookie with it (same origin, so the browser
 * shares it), which means the parent tab can simply ask "am I signed in?" — no
 * token to pass through `postMessage`, and nothing for a cross-origin page to
 * forge. The popup closing is only a UX signal; the session cookie is the truth.
 */
export async function GET() {
  const jar = await cookies();
  const session = await getSessionByResumeToken(jar.get(CHECKOUT_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "No checkout in progress" }, { status: 404 });
  }
  if (!session.consentAt) return NextResponse.json(CONSENT_REQUIRED, { status: 428 });

  const authSession = await auth();
  if (!authSession?.user?.id || !authSession.user.email) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const resume = await setResumeToken(session.publicId, {
    method: "GOOGLE",
    email: authSession.user.email.toLowerCase(),
    userId: authSession.user.id,
    verifiedAt: new Date(),
    via: "GOOGLE",
  });
  jar.set(CHECKOUT_COOKIE, resume, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(RESUME_TTL_MS / 1000),
  });

  return NextResponse.json({
    ok: true,
    email: authSession.user.email,
    // The drawer re-reads /api/checkout afterwards for the freshly resolved
    // offer, so it is not duplicated here.
    revalidate: "/api/checkout",
  });
}

/**
 * Exchange the resume token for a real Morbin session.
 *
 * Used on the magic-link branch: the link proved the inbox, and this converts
 * that proof into a signed-in buyer without a password, so "my tickets" and a
 * later Google sign-in on the same address resolve to the same account.
 */
export async function POST() {
  const jar = await cookies();
  const token = jar.get(CHECKOUT_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: "No checkout in progress" }, { status: 404 });
  }
  const result = await signIn("verified-checkout", {
    resumeToken: token,
    redirect: false,
  });
  // `redirect: false` still writes the session cookie via the Auth.js handler.
  if (result?.error) {
    return NextResponse.json({ error: "Could not start your session" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, url: result?.url ?? null });
}

/** Sign a buyer out and drop their checkout, e.g. the "sign in as someone else" link. */
export async function DELETE() {
  await signOut({ redirect: false });
  const jar = await cookies();
  jar.set(CHECKOUT_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return NextResponse.json({ ok: true });
}
