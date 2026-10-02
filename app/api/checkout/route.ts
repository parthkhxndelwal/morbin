import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  CHECKOUT_COOKIE,
  RESUME_TTL_MS,
  answerLookup,
  CONSENT_REQUIRED,
  answerStep,
  branchClaimedUnitsFor,
  claimedUnitsFor,
  createCheckoutSession,
  flowForSession,
  getCheckoutSession,
  getSessionByResumeToken,
  recordConsent,
  saveCustomFields,
  setContactEmail,
  saveQuantity,
  setResumeToken,
} from "@/lib/checkout";
import { getBranding } from "@/lib/branding";
import { getDb, toObjectId } from "@/lib/db";
import { getTicketTypes } from "@/lib/events";
import { emailMatchesIdentity, getActiveFlow, getFlowDraft, resolveOffer } from "@/lib/flows";
import { verifyTestRun } from "@/lib/test-run";
import { lookupIdentityStep } from "@/lib/flow-rules";
import { matchLookup } from "@/lib/lookups";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { maskEmail } from "@/lib/template-rules";
import { getPlatformSettings, pricingPolicyFor } from "@/lib/platform-settings";
import { computePricing } from "@/lib/pricing";
import { NOTICE_VERSION, checkoutNotice } from "@/lib/privacy-notice";
import type { CheckoutFlow, Event, FlowOption, FlowStep, Organization, TicketType } from "@/lib/types";

/**
 * The checkout funnel, server-authoritative.
 *
 * One route family holds the whole state machine. The drawer is a thin renderer
 * of what this returns: it can hide a step, but it cannot grant one, and every
 * decision here is recomputed from the stored flow rather than trusted from the
 * client. `POST /api/orders` re-runs the same `resolveOffer` before taking money.
 */

const MAX_TEXT = 200;

/** Lookup attempts, so the endpoint can't be used to enumerate a dataset. */
const LOOKUP_WINDOW_MS = 10 * 60 * 1000;
const LOOKUPS_PER_SESSION = 10;
const LOOKUPS_PER_IP = 40;

/**
 * The flow as the drawer sees it. A lookup step exposes only its wording and
 * input hint — never which dataset, column or email template it uses.
 */
function publicSteps(steps: FlowStep[]) {
  return steps.map((s) =>
    s.kind === "LOOKUP"
      ? { id: s.id, kind: s.kind, title: s.title, description: s.description ?? null, required: s.required, inputHint: s.lookup?.inputHint ?? null }
      : s,
  );
}

async function loadSessionFromCookie() {
  const jar = await cookies();
  return getSessionByResumeToken(jar.get(CHECKOUT_COOKIE)?.value);
}

/** Attach the resume cookie. httpOnly so page script cannot read or forge it. */
async function setResumeCookie(resumeToken: string) {
  const jar = await cookies();
  jar.set(CHECKOUT_COOKIE, resumeToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(RESUME_TTL_MS / 1000),
  });
}

async function clearResumeCookie() {
  const jar = await cookies();
  jar.set(CHECKOUT_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

/**
 * Everything the drawer needs to render its current step, in one payload.
 * Re-resolved on every call — never cached client-side, never trusted from it.
 */
async function describe(session: NonNullable<Awaited<ReturnType<typeof getCheckoutSession>>>) {
  const eventOid = toObjectId(session.eventId);
  const db = await getDb();
  const [event, flow, ticketTypes, branding] = await Promise.all([
    eventOid ? db.collection<Event>("events").findOne({ _id: eventOid }) : null,
    flowForSession(session),
    getTicketTypes(session.eventId),
    getBranding(session.eventId),
  ]);

  // A session whose event vanished or ended must not keep offering seats.
  const testable = session.test && event?.status === "DRAFT";
  if (!event || (event.status !== "PUBLISHED" && !testable) || event.endsAt < new Date()) {
    return { gone: true as const };
  }

  const branchValue = session.branch?.value ?? null;
  const [claimed, branchClaimed] = await Promise.all([
    session.identity.email
      ? claimedUnitsFor(session.eventId, session.identity.email, branchValue)
      : Promise.resolve(0),
    branchValue ? branchClaimedUnitsFor(session.eventId, branchValue) : Promise.resolve(0),
  ]);

  const offer = resolveOffer({
    flow,
    answers: session.answers,
    identity: {
      method: session.identity.method,
      email: session.identity.email,
      verified: !!session.identity.verifiedAt,
    },
    ticketTypes: ticketTypes as TicketType[],
    claimedUnits: claimed,
    branchClaimedUnits: branchClaimed,
  });

  // The price breakdown for what is in the cart right now, computed here so the
  // drawer only ever displays the figures the order route will charge.
  const [org, settings] = await Promise.all([
    db
      .collection<Organization>("organizations")
      .findOne(
        { _id: toObjectId(event.organizationId) as never },
        { projection: { name: 1, feeBps: 1, feeBearer: 1, retentionMonths: 1 } },
      ),
    getPlatformSettings(),
  ]);
  const policy = pricingPolicyFor(org ?? {}, event, settings);
  const offered = new Map(offer.ticketTypes.map((t) => [t.id, t]));
  const cart = offer.forcedItems
    ? offer.forcedItems
    : Object.entries(session.quantity).map(([ticketTypeId, quantity]) => ({ ticketTypeId, quantity }));
  const lines = cart.flatMap((c) => {
    const t = offered.get(c.ticketTypeId);
    return t && c.quantity > 0 ? [{ unitPricePaise: t.pricePaise, quantity: c.quantity }] : [];
  });
  const quote = computePricing(lines, policy);

  return {
    gone: false as const,
    event: {
      id: session.eventId,
      slug: event.slug,
      title: event.title,
      venue: event.venue,
      startsAt: event.startsAt.toISOString(),
      endsAt: event.endsAt.toISOString(),
      timezone: event.timezone,
    },
    pricing: {
      feeBps: policy.feeBps,
      gstBps: policy.gstBps,
      bearer: policy.bearer,
      gstLabel: settings.gst.splitRule === "ALWAYS_IGST" ? "IGST" : "GST",
      quote: {
        ticketTotalPaise: quote.ticketTotalPaise,
        feePaise: quote.feePaise,
        feeBasePaise: quote.feeBasePaise,
        feeGstPaise: quote.feeGstPaise,
        orderTotalPaise: quote.orderTotalPaise,
      },
    },
    flow: { version: flow.version, steps: publicSteps(flow.steps) },
    answers: session.answers,
    branch: session.branch,
    identity: {
      // The *resolved* method, not the stored one. The stored value is only
      // written once an address has been verified, but the drawer has to know
      // which method to ask the moment a branch is chosen — and the offer is
      // where the branch policy has already been applied.
      method: offer.identity.method,
      email: session.identity.email,
      verified: !!session.identity.verifiedAt,
      via: session.identity.via,
      // The address a lookup derived, masked until it's verified: the buyer
      // sees where the link goes without the endpoint revealing the dataset.
      lookupEmail: (() => {
        const step = lookupIdentityStep(flow);
        const derived = step ? session.lookups?.[step.id]?.derivedEmail : null;
        if (!derived) return null;
        return session.identity.verifiedAt && session.identity.email === derived ? derived : maskEmail(derived);
      })(),
    },
    offer,
    branding: {
      accentColor: branding.accentColor,
      ctaLabel: branding.ctaLabel,
      customFields: branding.customFields,
    },
    /** DPDP notice, accepted (unticked by default) before any personal data is sent. */
    privacy: {
      consented: !!session.consentAt,
      noticeVersion: NOTICE_VERSION,
      notice: checkoutNotice({
        organizerName: org?.name ?? "",
        retentionMonths: org?.retentionMonths ?? settings.defaultRetentionMonths,
      }),
    },
    /** A builder test run: the drawer stops at "This is where the buyer would pay". */
    testRun: !!session.test,
    /** Only ever sent when the server already knows the address is verified. */
    resumeTokenRequired: !session.identity.verifiedAt,
  };
}

/** POST — open a drawer. Reuses a live session so a refresh does not lose answers. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    eventId?: string;
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
    /** Signed by the builder's "Run through checkout as a buyer". */
    testToken?: string;
  };
  if (!body.eventId || !toObjectId(body.eventId)) {
    return NextResponse.json({ error: "Invalid event" }, { status: 400 });
  }
  const test = verifyTestRun(body.testToken);
  if (body.testToken && (!test || test.eventId !== body.eventId)) {
    return NextResponse.json({ error: "This test link has expired. Start it again from Booking rules." }, { status: 403 });
  }
  const db = await getDb();
  const event = await db
    .collection<Event>("events")
    .findOne({ _id: toObjectId(body.eventId) as never, status: test ? { $in: ["PUBLISHED", "DRAFT"] } : "PUBLISHED" });
  if (!event || event.endsAt < new Date()) {
    return NextResponse.json({ error: "This event is not available" }, { status: 404 });
  }

  // Returning to an unfinished funnel continues it rather than starting over —
  // but a test run and a real checkout never share a session.
  const existing = await loadSessionFromCookie();
  if (
    existing &&
    existing.eventId === event._id.toString() &&
    !!existing.test === !!test &&
    (existing.status === "IN_PROGRESS" || existing.status === "IDENTITY_VERIFIED")
  ) {
    return NextResponse.json(await describe(existing), { status: 200 });
  }

  // A test run follows the draft (falling back to the live rules), frozen now.
  const draft = test ? await getFlowDraft(event._id.toString()) : null;
  const flow = draft ?? (await getActiveFlow(event._id.toString()));
  // UTM is captured here, at the top of the funnel, and is the only place in the
  // app that reads it. The QR code on a poster is the acquisition channel, so
  // without this the campaign is unattributable end to end.
  const session = await createCheckoutSession({
    eventId: event._id.toString(),
    flowVersion: flow.version,
    testFlow: test ? { version: flow.version, steps: flow.steps } : null,
    utm: {
      source: body.utm_source?.slice(0, MAX_TEXT) ?? null,
      medium: body.utm_medium?.slice(0, MAX_TEXT) ?? null,
      campaign: body.utm_campaign?.slice(0, MAX_TEXT) ?? null,
    },
  });
  const resume = await setResumeToken(session.publicId, {});
  await setResumeCookie(resume);
  return NextResponse.json(await describe(session), { status: 201 });
}

/** GET — current state. Drives refresh, resume-after-magic-link, and the popup. */
export async function GET() {
  const session = await loadSessionFromCookie();
  if (!session) return NextResponse.json({ error: "No checkout in progress" }, { status: 404 });
  return NextResponse.json(await describe(session));
}

/** PATCH — answer a question, or bind an identity once it is proven. */
export async function PATCH(request: Request) {
  const session = await loadSessionFromCookie();
  if (!session) return NextResponse.json({ error: "No checkout in progress" }, { status: 404 });
  if (session.status === "EXPIRED") {
    return NextResponse.json({ error: "This checkout expired. Please start again." }, { status: 410 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    action?: string;
    stepId?: string;
    value?: string;
    email?: string;
    customFields?: Record<string, string>;
    quantity?: Record<string, number>;
    noticeVersion?: string;
  };

  if (body.action === "consent") {
    // Only the version the server would show counts: a stale page re-reads first.
    if (body.noticeVersion !== NOTICE_VERSION) {
      return NextResponse.json({ error: "The privacy notice was updated. Please review it again." }, { status: 409 });
    }
    await recordConsent(session.publicId, NOTICE_VERSION);
    return NextResponse.json(await describe((await getCheckoutSession(session.publicId))!));
  }

  // Every other action but a seat count carries personal data (answers, IDs,
  // email, details), so none of it is accepted before consent.
  if (!session.consentAt && body.action !== "quantity") return NextResponse.json(CONSENT_REQUIRED, { status: 428 });

  if (body.action === "answer") {
    if (!body.stepId || typeof body.value !== "string") {
      return NextResponse.json({ error: "Invalid answer" }, { status: 400 });
    }
    const flow: CheckoutFlow = await flowForSession(session);
    const step: FlowStep | undefined = flow.steps.find((s: FlowStep) => s.id === body.stepId);
    if (!step) return NextResponse.json({ error: "Unknown step" }, { status: 400 });
    if (step.kind === "LOOKUP" && step.lookup) {
      const [perSession, perIp] = await Promise.all([
        rateLimit("lookup:session", session.publicId, LOOKUPS_PER_SESSION, LOOKUP_WINDOW_MS),
        rateLimit("lookup:ip", await clientIp(), LOOKUPS_PER_IP, LOOKUP_WINDOW_MS),
      ]);
      if (!perSession || !perIp) {
        return NextResponse.json({ error: "Too many attempts. Wait a few minutes and try again." }, { status: 429 });
      }
      const value = body.value.trim().slice(0, 100);
      if (!value) return NextResponse.json({ error: "Enter a value to continue." }, { status: 400 });
      const db = await getDb();
      const event = await db
        .collection<Event>("events")
        .findOne({ _id: toObjectId(session.eventId) as never }, { projection: { organizationId: 1 } });
      if (!event) return NextResponse.json({ error: "This event is not available" }, { status: 404 });
      const match = await matchLookup(event.organizationId, session.eventId, step.lookup, value);
      if (!match.ok) {
        // Says what was typed, never anything from the dataset.
        const error =
          match.reason === "taken"
            ? "This ID already has a ticket."
            : match.reason === "no_email"
              ? "We couldn't work out your email address from this ID. Please contact the organiser."
              : `We couldn't find ${value} in the list.`;
        return NextResponse.json({ error }, { status: match.reason === "taken" ? 409 : 422 });
      }
      await answerLookup(session.publicId, step.id, value, {
        datasetId: step.lookup.datasetId,
        key: match.key,
        derivedEmail: match.derivedEmail,
      });
      return NextResponse.json(await describe((await getCheckoutSession(session.publicId))!));
    }
    if (step.kind === "SINGLE_CHOICE") {
      // The answer must be one of the options the flow actually offers, so a
      // crafted request cannot invent an audience the organizer never defined.
      const option: FlowOption | undefined = step.options?.find(
        (o: FlowOption) => o.value === body.value,
      );
      if (!option) return NextResponse.json({ error: "Invalid choice" }, { status: 400 });
      await answerStep(session.publicId, step.id, option.value, {
        stepId: step.id,
        optionId: option.id,
        value: option.value,
      });
    } else {
      await answerStep(session.publicId, step.id, body.value, session.branch);
    }
    return NextResponse.json(await describe((await getCheckoutSession(session.publicId))!));
  }

  if (body.action === "identity") {
    const flow: CheckoutFlow = await flowForSession(session);
    const step: FlowStep | undefined = flow.steps.find(
      (s: FlowStep) => s.kind === "SINGLE_CHOICE" && session.branch?.stepId === s.id,
    );
    const option: FlowOption | null =
      step?.options?.find((o: FlowOption) => o.value === session.branch?.value) ?? null;
    const required = option?.identity?.method ?? "NONE";

    if (required === "GOOGLE") {
      // Authority is the Google session, not anything the client sends.
      const authSession = await auth();
      const email = authSession?.user?.email?.toLowerCase() ?? null;
      if (!authSession?.user?.id || !email) {
        return NextResponse.json({ error: "Sign in with Google to continue" }, { status: 401 });
      }
      if (!emailMatchesIdentity(option?.identity ?? null, email)) {
        return NextResponse.json(
          { error: "That email address is not eligible for this ticket." },
          { status: 403 },
        );
      }
      const resume = await setResumeToken(session.publicId, {
        method: "GOOGLE",
        email,
        userId: authSession.user.id,
        verifiedAt: new Date(),
        via: "GOOGLE",
      });
      await setResumeCookie(resume);
      return NextResponse.json(await describe((await getCheckoutSession(session.publicId))!));
    }

    if (required === "EMAIL_OTP") {
      // Reaching here without a verified session means the buyer needs the link.
      return NextResponse.json(
        { needsMagicLink: true, domain: option?.identity?.emailDomain ?? null },
        { status: 428 },
      );
    }

    return NextResponse.json({ error: "This event does not require sign-in" }, { status: 400 });
  }

  if (body.action === "contact") {
    // Only for groups that verify nobody: everyone else's address comes from
    // Google or a confirmed link, never from this field.
    const flow = await flowForSession(session);
    const method = resolveOffer({
      flow,
      answers: session.answers,
      identity: { method: session.identity.method, email: session.identity.email, verified: !!session.identity.verifiedAt },
      ticketTypes: [],
    }).identity.method;
    if (method !== "NONE" || session.identity.verifiedAt) {
      return NextResponse.json({ error: "Confirm your email to continue" }, { status: 403 });
    }
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
      return NextResponse.json({ error: "Enter a valid email address for your tickets." }, { status: 400 });
    }
    await setContactEmail(session.publicId, email);
    return NextResponse.json(await describe((await getCheckoutSession(session.publicId))!));
  }

  if (body.action === "quantity") {
    // Stored, never trusted. The order route re-checks every number against the
    // freshly resolved offer, so an out-of-range value here cannot sell a seat.
    await saveQuantity(session.publicId, body.quantity ?? {});
    // The fresh state carries the price breakdown for exactly this cart.
    return NextResponse.json(await describe((await getCheckoutSession(session.publicId))!));
  }

  if (body.action === "customFields") {
    const branding = await getBranding(session.eventId);
    const byId = new Map(branding.customFields.map((f) => [f.id, f]));
    const submitted = body.customFields ?? {};
    const clean: Record<string, string> = {};

    // Required-ness is checked against the organizer's field list, not against
    // what the client happened to send. Iterating the submission instead would
    // let a client omit a required field entirely and pass, which is the one
    // thing a required field exists to prevent.
    for (const field of branding.customFields) {
      if (!field.required) continue;
      const raw = submitted[field.id];
      if (typeof raw !== "string" || !raw.trim()) {
        return NextResponse.json({ error: `${field.label} is required` }, { status: 400 });
      }
    }

    for (const [id, raw] of Object.entries(submitted)) {
      const field = byId.get(id);
      // Drop unknown ids and truncate rather than reject, so a stale field from an
      // older version of the form cannot block checkout.
      if (!field || typeof raw !== "string") continue;
      const value = raw.trim().slice(0, field.maxLength ?? 500);
      if (value) clean[id] = value;
    }
    await saveCustomFields(session.publicId, clean);
    return NextResponse.json(await describe((await getCheckoutSession(session.publicId))!));
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

/** DELETE — abandon. The drawer can be closed and reopened without a new session. */
export async function DELETE() {
  await clearResumeCookie();
  return NextResponse.json({ ok: true });
}
