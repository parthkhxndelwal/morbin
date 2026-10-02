import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  CHECKOUT_COOKIE,
  branchClaimedUnitsFor,
  flowForSession,
  consumeOtp,
  getCheckoutSession,
  getSessionByResumeToken,
  issueOtp,
  recordFailedOtpAttempt,
  resendWaitSeconds,
  setResumeToken,
} from "@/lib/checkout";
import { getDb, toObjectId } from "@/lib/db";
import { appUrl } from "@/lib/email";
import { emailMatchesIdentity } from "@/lib/flows";
import { lookupIdentityStep } from "@/lib/flow-rules";
import type { CheckoutFlow, EmailRecord, Event, FlowOption } from "@/lib/types";

/**
 * The college-email branch of the funnel.
 *
 * `POST`   — ask for a link. Answers identically for every outcome so the
 *            endpoint cannot be used to discover which addresses exist or are
 *            eligible.
 * `GET`    — consume a link. The single place a verified buyer identity is born.
 */

const requestSchema = z.object({
  // Optional only when a lookup question derived the address.
  email: z.string().email().max(200).optional(),
});

/** Never say anything that distinguishes these cases. */
const GENERIC = "If that address is eligible, a link is on its way.";

/** The option whose policy governs identity for the session's current branch. */
async function identityOption(flow: CheckoutFlow, branchValue: string | null) {
  if (!branchValue) return null;
  for (const step of flow.steps) {
    if (step.kind !== "SINGLE_CHOICE" || !step.options) continue;
    const option: FlowOption | undefined = step.options.find(
      (o: FlowOption) => o.value === branchValue,
    );
    if (option?.identity) return option;
  }
  return null;
}

export async function POST(request: Request) {
  const jar = await cookies();
  const session = await getSessionByResumeToken(jar.get(CHECKOUT_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ message: GENERIC }, { status: 202 });
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ message: GENERIC }, { status: 202 });
  }

  // A lookup that derives the address decides it: whatever the client sends is
  // ignored, so the link can only ever go to the address the dataset row implies.
  const flow = await flowForSession(session);
  const lookupStep = lookupIdentityStep(flow);
  const option = await identityOption(flow, session.branch?.value ?? null);
  let email: string;
  if (lookupStep) {
    const derived = session.lookups?.[lookupStep.id]?.derivedEmail;
    if (!derived) return NextResponse.json({ message: GENERIC }, { status: 202 });
    email = derived;
  } else {
    if (!parsed.data.email) return NextResponse.json({ message: GENERIC }, { status: 202 });
    email = parsed.data.email.toLowerCase();
    const method = option?.identity?.method ?? session.identity.method;
    if (method !== "EMAIL_OTP") {
      return NextResponse.json({ message: GENERIC }, { status: 202 });
    }
    // Domain check lives here, on the server. A crafted request cannot talk its way
    // past it, and a `403` would leak which addresses the organizer accepts — so
    // an ineligible address simply receives nothing.
    if (!emailMatchesIdentity(option?.identity ?? null, email)) {
      return NextResponse.json({ message: GENERIC }, { status: 202 });
    }
  }

  // Respect the branch's own seat allowance before spending an email send.
  if (typeof option?.capacity === "number") {
    const used = await branchClaimedUnitsFor(session.eventId, session.branch?.value ?? null);
    if (used >= option.capacity) {
      return NextResponse.json({ message: GENERIC }, { status: 202 });
    }
  }

  // A builder test run sends no email: the address counts as confirmed, so the
  // organiser can walk the rest of the journey.
  if (session.test) {
    const resume = await setResumeToken(session.publicId, {
      method: "EMAIL_OTP",
      email,
      verifiedAt: new Date(),
      via: "EMAIL_OTP",
    });
    jar.set(CHECKOUT_COOKIE, resume, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 2 * 60 * 60,
    });
    return NextResponse.json({ testVerified: true, email }, { status: 200 });
  }

  const wait = await resendWaitSeconds(session.publicId);
  if (wait > 0) {
    return NextResponse.json({ message: GENERIC }, { status: 202 });
  }

  const { raw } = await issueOtp(session.publicId, email);

  const db = await getDb();
  const event = await db
    .collection<Event>("events")
    .findOne({ _id: toObjectId(session.eventId) as never });
  const link = `${appUrl("/checkout/verify")}?token=${encodeURIComponent(raw)}`;

  // Queued, not sent inline: a slow SES call must not hold the request open, and
  // the existing cron retries anything left QUEUED.
  await db.collection<EmailRecord>("emailDeliveries").insertOne({
    orderId: null,
    ticketId: null,
    recipient: email,
    kind: "FLOW_MAGIC_LINK",
    status: "QUEUED",
    attempts: 0,
    lastError: null,
    meta: {
      eventTitle: event?.title ?? "your event",
      eventVenue: event?.venue ?? "",
      attendeeName: email.split("@")[0],
      ticketCode: link,
      qrSvg: null,
    },
  });

  // Best effort inline delivery, bounded. Failure is invisible to the buyer and
  // picked up by the cron.
  try {
    const { flushEmailQueue } = await import("@/lib/email");
    await flushEmailQueue(5);
  } catch {
    /* cron retries */
  }

  // No `retryAfterSeconds` here, and none in the throttled branch above: the
  // drawer's own countdown runs from the moment it sent, and including it would
  // make a throttled-but-eligible request distinguishable from a never-eligible
  // one — which is the enumeration oracle the uniform `GENERIC` body exists to
  // prevent.
  return NextResponse.json({ message: GENERIC }, { status: 202 });
}

/**
 * Consume a magic link and mint the session.
 *
 * The burn is single-use and the comparison is over fixed-width hashes, so two
 * clicks racing each other produce exactly one winner and one "link already
 * used" — never two buyers sharing an identity.
 */
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("token") ?? "";
  const result = await consumeOtp(raw);

  if (!result.ok) {
    if (result.reason === "attempts") await recordFailedOtpAttempt(raw);
    const jar = await cookies();
    const session = await getSessionByResumeToken(jar.get(CHECKOUT_COOKIE)?.value);
    const slug = session ? await slugFor(session.eventId) : null;
    return NextResponse.json(
      {
        ok: false,
        reason: result.reason,
        eventSlug: slug,
        // The link is dead but the drawer is not: the buyer may re-request, or
        // switch to the other branch entirely.
        canRetry: !!session,
      },
      { status: 400 },
    );
  }

  const resume = await setResumeToken(result.session.publicId, {
    userId: result.session.identity.userId,
  });
  const jar = await cookies();
  jar.set(CHECKOUT_COOKIE, resume, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 2 * 60 * 60,
  });

  const fresh = (await getCheckoutSession(result.session.publicId))!;
  return NextResponse.json({
    ok: true,
    checkoutSessionId: fresh.publicId,
    eventSlug: await slugFor(fresh.eventId),
    email: fresh.identity.email,
  });
}

async function slugFor(eventId: string): Promise<string | null> {
  const db = await getDb();
  const event = await db.collection<Event>("events").findOne({ _id: toObjectId(eventId) as never });
  return event?.slug ?? null;
}
