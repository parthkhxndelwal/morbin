import { cookies } from "next/headers";
import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import {
  CHECKOUT_COOKIE,
  CONSENT_REQUIRED,
  branchClaimedUnitsFor,
  claimedUnitsFor,
  getSessionByResumeToken,
  setOrder,
} from "@/lib/checkout";
import { getBranding } from "@/lib/branding";
import { getDb, toObjectId } from "@/lib/db";
import { getTicketTypes } from "@/lib/events";
import { getActiveFlow, resolveOffer } from "@/lib/flows";
import { lookupIdentityStep, lookupSteps } from "@/lib/flow-rules";
import { matchLookup } from "@/lib/lookups";
import { flushEmailQueue } from "@/lib/email";
import { createHeldOrder, releaseOrder } from "@/lib/orders";
import { getPlatformSettings, pricingPolicyFor } from "@/lib/platform-settings";
import { computePricing } from "@/lib/pricing";
import { TxAbort } from "@/lib/tx";
import { createTicketOrder } from "@/lib/razorpay";
import type { Event, Order, Organization, TicketType } from "@/lib/types";

/**
 * Creates the order for a checkout session.
 *
 * The browser sends no prices, no ticket ids and no buyer details. Contents,
 * caps and eligibility all come from the stored session, and then the *same*
 * `resolveOffer` the drawer rendered is re-run here. A client that was modified,
 * replayed or simply out of date therefore cannot talk this route into selling a
 * type the buyer is not entitled to, or charging a different amount.
 *
 * Pricing comes from `lib/pricing.ts` with the organisation's admin-set fee and
 * the event's fee bearer, and is frozen on the order. Seats are held in the
 * same transaction that inserts the order, before any money moves.
 */

export async function POST() {
  const jar = await cookies();
  const session = await getSessionByResumeToken(jar.get(CHECKOUT_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "No checkout in progress" }, { status: 404 });
  }
  if (session.status === "EXPIRED") {
    return NextResponse.json(
      { error: "This checkout expired. Please start again." },
      { status: 410 },
    );
  }
  // A builder test run never takes money or holds seats — enforced here, not
  // just by the drawer hiding the button.
  if (session.test) {
    return NextResponse.json(
      { error: "This is a test run. This is where the buyer would pay.", testRun: true },
      { status: 403 },
    );
  }
  if (!session.consentAt) return NextResponse.json(CONSENT_REQUIRED, { status: 428 });
  if (session.orderId) {
    return NextResponse.json(
      { error: "This order has already been created" },
      { status: 409 },
    );
  }

  const db = await getDb();
  const eventOid = toObjectId(session.eventId);
  const event = eventOid
    ? await db.collection<Event>("events").findOne({ _id: eventOid })
    : null;
  if (!event || event.status !== "PUBLISHED") {
    return NextResponse.json({ error: "This event is not available" }, { status: 404 });
  }
  if (event.endsAt < new Date()) {
    return NextResponse.json({ error: "This event has ended" }, { status: 400 });
  }

  const org = await db
    .collection<Organization>("organizations")
    .findOne({ _id: toObjectId(event.organizationId) as never });
  if (org?.status === "SUSPENDED") {
    return NextResponse.json(
      { error: "This organization is suspended and is not accepting orders" },
      { status: 403 },
    );
  }

  // A republish mid-funnel must not move the goalposts under a buyer who is
  // already holding an open drawer, so the session's pinned version has to still
  // be the live one.
  const flow = await getActiveFlow(session.eventId);
  if (flow.version !== session.flowVersion) {
    return NextResponse.json(
      { error: "The booking rules changed. Please reopen checkout." },
      { status: 409 },
    );
  }

  const ticketTypes = (await getTicketTypes(session.eventId)) as TicketType[];
  const branchValue = session.branch?.value ?? null;
  // BOTH populations are needed. `claimed` is this buyer's own history (the
  // "one per login" rule); `branchClaimed` is everyone else's (the branch's seat
  // allowance). Passing only the first let an exhausted audience keep selling —
  // the offer said sold out and the order route disagreed, because they were
  // resolving the same flow with different inputs.
  const [claimed, branchClaimed] = await Promise.all([
    session.identity.email
      ? claimedUnitsFor(session.eventId, session.identity.email, branchValue)
      : Promise.resolve(0),
    branchValue
      ? branchClaimedUnitsFor(session.eventId, branchValue)
      : Promise.resolve(0),
  ]);

  const offer = resolveOffer({
    flow,
    answers: session.answers,
    identity: {
      method: session.identity.method,
      email: session.identity.email,
      verified: !!session.identity.verifiedAt,
    },
    ticketTypes,
    claimedUnits: claimed,
    branchClaimedUnits: branchClaimed,
  });

  if (offer.missingRequiredSteps.length > 0) {
    return NextResponse.json({ error: "Please answer all questions first" }, { status: 400 });
  }
  if (flow.steps.some((s) => s.kind === "IDENTITY" && s.required) && !session.identity.verifiedAt) {
    return NextResponse.json({ error: "Please confirm your email to continue" }, { status: 403 });
  }
  // Any group that verifies (Google, email link, ID-derived email) must have
  // done so; only a NONE group books with an unverified contact address.
  if (offer.identity.method !== "NONE" && !session.identity.verifiedAt) {
    return NextResponse.json({ error: "Please confirm your email to continue" }, { status: 403 });
  }
  if (offer.soldOutForIdentity) {
    return NextResponse.json({ error: "No tickets available for you" }, { status: 409 });
  }

  // Contents: either the flow already decided them, or the buyer chose.
  const chosen: { ticketTypeId: string; quantity: number }[] = [...(offer.forcedItems ?? [])];
  if (!offer.forcedItems) {
    for (const [ticketTypeId, quantity] of Object.entries(session.quantity)) {
      if (quantity > 0) chosen.push({ ticketTypeId, quantity });
    }
  }
  if (chosen.length === 0) {
    return NextResponse.json({ error: "Select at least one ticket" }, { status: 400 });
  }

  // Merge duplicate lines so a crafted payload cannot hold more inventory than
  // the sum it declares, then re-check every ceiling against server-side data.
  const merged = new Map<string, number>();
  for (const item of chosen) {
    merged.set(item.ticketTypeId, (merged.get(item.ticketTypeId) ?? 0) + item.quantity);
  }
  const byId = new Map(ticketTypes.map((t) => [t._id!.toString(), t]));
  const orderItems: Order["items"] = [];
  for (const [ticketTypeId, quantity] of merged) {
    const t = byId.get(ticketTypeId);
    const offered = offer.ticketTypes.find((o) => o.id === ticketTypeId);
    if (!t || t.eventId !== event._id!.toString()) {
      return NextResponse.json({ error: "Invalid ticket type" }, { status: 400 });
    }
    if (!offered) {
      return NextResponse.json({ error: "That ticket is not available for you" }, { status: 403 });
    }
    if (quantity > offered.maxSelectable) {
      return NextResponse.json(
        { error: `You can book at most ${offered.maxSelectable} × ${t.name}` },
        { status: 400 },
      );
    }
    if (t.saleStartsAt && t.saleStartsAt > new Date()) {
      return NextResponse.json({ error: `Sales not open for ${t.name}` }, { status: 400 });
    }
    if (t.saleEndsAt && t.saleEndsAt < new Date()) {
      return NextResponse.json({ error: `Sales closed for ${t.name}` }, { status: 400 });
    }
    orderItems.push({ ticketTypeId, name: t.name, quantity, unitPricePaise: t.pricePaise });
  }

  // Lookup answers are re-checked here, not trusted from when they were
  // typed: the row may have been deleted, or claimed by someone else since.
  const lookupKeys: NonNullable<Order["lookupKeys"]> = [];
  for (const step of lookupSteps(flow)) {
    const stored = session.lookups?.[step.id];
    const value = session.answers[step.id];
    if (!stored || !value) {
      if (step.required === false) continue;
      return NextResponse.json({ error: "Please answer all questions first" }, { status: 400 });
    }
    const again = await matchLookup(event.organizationId, session.eventId, step.lookup!, value);
    if (!again.ok || again.key !== stored.key || again.derivedEmail !== stored.derivedEmail) {
      const error = again.ok || again.reason !== "taken" ? "Your ID could no longer be confirmed. Please reopen checkout." : "This ID already has a ticket.";
      return NextResponse.json({ error }, { status: 409 });
    }
    lookupKeys.push({ stepId: step.id, datasetId: step.lookup!.datasetId, key: again.key, claim: step.lookup!.oneTicketPerRow });
  }

  // Name and contact come from the verified identity, never from a form.
  const buyerEmail = session.identity.email;
  if (!buyerEmail) {
    return NextResponse.json({ error: "No confirmed email for this order" }, { status: 403 });
  }
  // With an email-from-template lookup, the ticket goes to the derived address
  // and nowhere else.
  const identityStep = lookupIdentityStep(flow);
  if (identityStep) {
    const derived = session.lookups?.[identityStep.id]?.derivedEmail;
    if (!session.identity.verifiedAt || !derived || buyerEmail !== derived) {
      return NextResponse.json({ error: "Please confirm your email to continue" }, { status: 403 });
    }
  }
  // A field whose id mentions "name" is treated as the attendee's name for the
  // ticket; anything else is recorded but not used to address a ticket.
  const fieldLabels = new Map(
    (await getBranding(session.eventId)).customFields.map((f) => [f.id, f.label]),
  );
  const buyerName = customName(session.customFields) ?? buyerEmail.split("@")[0];

  const settings = await getPlatformSettings();
  const policy = pricingPolicyFor(org ?? {}, event, settings);
  const pricing = computePricing(
    orderItems.map((i) => ({ unitPricePaise: i.unitPricePaise, quantity: i.quantity })),
    policy,
  );
  const orderOid = new ObjectId();
  const orderIdStr = orderOid.toString();

  const order: Order = {
    _id: orderOid,
    eventId: event._id!.toString(),
    organizationId: event.organizationId,
    buyerName,
    buyerEmail,
    buyerPhone: "",
    items: orderItems,
    attendees: [],
    // Legacy summary fields, kept in step with `pricing` for older readers.
    subtotalPaise: pricing.ticketTotalPaise,
    platformFeePaise: pricing.feePaise,
    organizerAmountPaise: pricing.organiserNetPaise,
    totalPaise: pricing.orderTotalPaise,
    pricing,
    currency: "INR",
    razorpayOrderId: `pending-${orderIdStr}`,
    razorpayPaymentId: null,
    status: "CREATED",
    checkoutSessionId: session.publicId,
    flowVersion: session.flowVersion,
    flowBranch: session.branch?.value ?? null,
    identityMethod: session.identity.via,
    utm: session.utm,
    consentAt: session.consentAt,
    noticeVersion: session.noticeVersion ?? null,
    lookupKeys: lookupKeys.length ? lookupKeys : null,
    // Labelled from the organizer's own field list, so the orders export reads
    // "Full name" rather than the internal `cf_name` id. An id the branding no
    // longer lists (a field since removed) still records its value.
    customFields: Object.entries(session.customFields).map(([fieldId, value]) => ({
      fieldId,
      label: fieldLabels.get(fieldId) ?? fieldId,
      value,
    })),
    refundedPaise: 0,
    createdAt: new Date(),
    paidAt: null,
  };

  // Seats are held and the order inserted in one transaction: either both
  // happen or neither does. Free orders are completed (tickets issued) inside
  // the same transaction.
  try {
    await createHeldOrder(order);
  } catch (error) {
    if (error instanceof TxAbort) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[checkout:order:hold]", error);
    return NextResponse.json({ error: "Unable to create order" }, { status: 500 });
  }

  if (pricing.orderTotalPaise === 0) {
    await setOrder(session.publicId, orderIdStr);
    try {
      await flushEmailQueue(20);
    } catch {
      /* the scheduler retries */
    }
    return NextResponse.json({ orderId: orderIdStr, free: true, amountPaise: 0 }, { status: 201 });
  }

  if (!process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID) {
    await releaseOrder(orderOid, "FAILED");
    return NextResponse.json({ error: "Payments are not configured" }, { status: 503 });
  }
  try {
    const rzpOrder = await createTicketOrder({
      amountPaise: pricing.orderTotalPaise,
      receipt: orderIdStr,
      // Ids only — no buyer details leave the server in payment metadata.
      notes: {
        eventId: order.eventId,
        organizationId: order.organizationId,
        orderId: orderIdStr,
        ...(session.utm.source ? { utm_source: session.utm.source } : {}),
        ...(session.utm.campaign ? { utm_campaign: session.utm.campaign } : {}),
      },
    });
    const db = await getDb();
    await db
      .collection<Order>("orders")
      .updateOne({ _id: orderOid, status: "CREATED" }, { $set: { razorpayOrderId: rzpOrder.id } });
    await setOrder(session.publicId, orderIdStr);
    return NextResponse.json(
      {
        orderId: orderIdStr,
        razorpayOrderId: rzpOrder.id,
        keyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
        amountPaise: pricing.orderTotalPaise,
      },
      { status: 201 },
    );
  } catch (error) {
    // No Razorpay order means nobody can pay; give the seats straight back.
    await releaseOrder(orderOid, "FAILED").catch(() => {});
    console.error("[checkout:order]", error);
    return NextResponse.json({ error: "Unable to create order" }, { status: 500 });
  }
}

/**
 * The buyer's name, from a custom field whose id mentions "name".
 *
 * The identity is verified, so the ticket is already addressed correctly; this
 * only improves what is printed on it. Matching on the id rather than the label
 * keeps it working for any organiser who named their field "Full name",
 * "Student name", or "Name".
 */
function customName(fields: Record<string, string>): string | null {
  for (const [key, value] of Object.entries(fields)) {
    if (/name/i.test(key) && value.trim()) return value.trim();
  }
  return null;
}
