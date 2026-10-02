import { ObjectId, type ClientSession, type Db } from "mongodb";
import { audit, notify } from "@/lib/audit";
import { getDb, toObjectId } from "@/lib/db";
import { formatINR } from "@/lib/format";
import { appendLedger, unsettledTotals } from "@/lib/ledger";
import { getPlatformSettings } from "@/lib/platform-settings";
import { refundCost, type RefundSpeed } from "@/lib/pricing";
import { findRefundForCase, refundPayment, type RazorpayRefund } from "@/lib/razorpay";
import { lockOrgBalance, TxAbort, withTransaction } from "@/lib/tx";
import type { EmailRecord, Order, RefundCase, Ticket } from "@/lib/types";

/**
 * Refund cases — the only way money goes back to a customer.
 *
 *   owner requests  → REQUESTED   (refund + its cost held from the unpaid balance)
 *   admin approves  → APPROVED    (tickets void, seats back on sale)
 *     Morbin settles   → PROCESSING → COMPLETED   via Razorpay's Refund API
 *                                  → FAILED → COMPLETED_MANUALLY (bank transfer)
 *     organisation settles         → COMPLETED_BY_ORG (owner records its reference)
 *   admin rejects / owner withdraws → REJECTED / CANCELLED (hold reversed)
 *
 * Refunds return ticket value only; the convenience fee is never refunded.
 * Every state change is a conditional update, so double clicks and retried
 * webhooks cannot apply a transition twice.
 */

export interface Actor {
  userId: string;
  role: "OWNER" | "ADMIN";
}

const OPEN: RefundCase["status"][] = ["REQUESTED", "APPROVED", "PROCESSING", "FAILED"];

function caseOid(id: string): ObjectId {
  const oid = toObjectId(id);
  if (!oid) throw new TxAbort("Refund not found", 404);
  return oid;
}

/** Ticket value of each ticket, falling back to the order line price for older tickets. */
function ticketValue(order: Order, t: Ticket): number {
  if (typeof t.unitPricePaise === "number") return t.unitPricePaise;
  return order.items.find((i) => i.ticketTypeId === t.ticketTypeId)?.unitPricePaise ?? 0;
}

export interface RefundQuote {
  ticketIds: string[];
  amountPaise: number;
  cost: RefundCase["cost"];
  /** Total held from the balance (Morbin-settled only). */
  holdPaise: number;
  unsettledPaise: number;
  /** Positive when the balance can't cover the hold. */
  shortfallPaise: number;
}

async function loadRefundable(
  db: Db,
  organizationId: string,
  orderId: string,
  ticketIds: string[],
  session?: ClientSession,
): Promise<{ order: Order; tickets: Ticket[] }> {
  const oid = toObjectId(orderId);
  if (!oid) throw new TxAbort("Order not found", 404);
  const order = await db.collection<Order>("orders").findOne({ _id: oid, organizationId }, { session });
  if (!order) throw new TxAbort("Order not found", 404);
  if (order.status !== "PAID" && order.status !== "PARTIALLY_REFUNDED") {
    throw new TxAbort("Only paid orders can be refunded.");
  }
  const ids = ticketIds.map(toObjectId).filter((x): x is ObjectId => !!x);
  if (ids.length === 0 || ids.length !== ticketIds.length) throw new TxAbort("Choose at least one ticket.");
  const tickets = await db
    .collection<Ticket>("tickets")
    .find({ _id: { $in: ids }, orderId: oid.toString() }, { session })
    .toArray();
  if (tickets.length !== ids.length) throw new TxAbort("Some of those tickets aren't part of this order.");
  for (const t of tickets) {
    if (t.status === "REFUNDED") throw new TxAbort(`Ticket ${t.code} is already refunded.`);
    if (t.refundCaseId) throw new TxAbort(`Ticket ${t.code} already has a refund in progress.`);
  }
  return { order, tickets };
}

function costFor(order: Order, amountPaise: number, speed: RefundSpeed, gstBps: number): RefundCase["cost"] {
  return refundCost({
    refundPaise: amountPaise,
    orderTotalPaise: order.pricing?.orderTotalPaise ?? order.totalPaise,
    // Orders before pricing existed always had the fee deducted from the organiser.
    bearer: order.pricing?.bearer ?? "ORGANISER",
    gatewayFeePaise: order.gateway?.feePaise ?? 0,
    speed,
    gstBps,
  });
}

/** Preview a refund request: amount, cost, and whether the balance covers it. */
export async function quoteRefund(input: {
  organizationId: string;
  orderId: string;
  ticketIds: string[];
  speed: RefundSpeed;
  settledBy: RefundCase["settledBy"];
}): Promise<RefundQuote> {
  const db = await getDb();
  const settings = await getPlatformSettings();
  const { order, tickets } = await loadRefundable(db, input.organizationId, input.orderId, input.ticketIds);
  const amountPaise = tickets.reduce((s, t) => s + ticketValue(order, t), 0);
  const morbin = input.settledBy === "MORBIN";
  const cost = morbin
    ? costFor(order, amountPaise, input.speed, settings.gst.rateBps)
    : { gatewayFeeSharePaise: 0, instantFeePaise: 0, instantFeeGstPaise: 0, totalPaise: 0 };
  const holdPaise = morbin ? amountPaise + cost.totalPaise : 0;
  const { totals } = await unsettledTotals(db, input.organizationId);
  return {
    ticketIds: tickets.map((t) => t._id!.toString()),
    amountPaise,
    cost,
    holdPaise,
    unsettledPaise: totals.netPaise,
    shortfallPaise: Math.max(0, holdPaise - totals.netPaise),
  };
}

/** Owner requests a refund. Holds refund + cost from the unpaid balance. */
export async function requestRefund(input: {
  organizationId: string;
  orderId: string;
  ticketIds: string[];
  speed: RefundSpeed;
  settledBy: RefundCase["settledBy"];
  reason: string;
  requestedBy: string;
  fromCancellation?: boolean;
}): Promise<RefundCase> {
  const settings = await getPlatformSettings();
  const created = await withTransaction(async (session, db) => {
    await lockOrgBalance(db, session, input.organizationId);
    const { order, tickets } = await loadRefundable(
      db,
      input.organizationId,
      input.orderId,
      input.ticketIds,
      session,
    );
    const amountPaise = tickets.reduce((s, t) => s + ticketValue(order, t), 0);
    const morbin = input.settledBy === "MORBIN";
    if (morbin && amountPaise > 0 && !order.razorpayPaymentId) {
      throw new TxAbort("This order has no payment to refund.");
    }
    const speed: RefundSpeed = morbin ? input.speed : "NORMAL";
    const cost = morbin
      ? costFor(order, amountPaise, speed, settings.gst.rateBps)
      : { gatewayFeeSharePaise: 0, instantFeePaise: 0, instantFeeGstPaise: 0, totalPaise: 0 };

    if (morbin) {
      const { totals } = await unsettledTotals(db, input.organizationId, { session });
      const hold = amountPaise + cost.totalPaise;
      if (totals.netPaise < hold) {
        throw new TxAbort(
          `Your unpaid balance is ${formatINR(totals.netPaise)}, but this refund needs ${formatINR(hold)} (including ${formatINR(cost.totalPaise)} in refund costs).`,
          409,
        );
      }
    }

    const now = new Date();
    const refundCase: RefundCase = {
      _id: new ObjectId(),
      organizationId: input.organizationId,
      eventId: order.eventId,
      orderId: order._id!.toString(),
      ticketIds: tickets.map((t) => t._id!.toString()),
      amountPaise,
      settledBy: input.settledBy,
      speed,
      cost,
      status: "REQUESTED",
      reason: input.reason.trim(),
      fromCancellation: !!input.fromCancellation,
      requestedBy: input.requestedBy,
      decidedBy: null,
      decisionNote: null,
      decidedAt: null,
      customer: { name: order.buyerName, email: order.buyerEmail },
      razorpayRefundId: null,
      arn: null,
      failureReason: null,
      manualReference: null,
      completedBy: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const caseId = refundCase._id!.toString();
    await db.collection<RefundCase>("refundCases").insertOne(refundCase, { session });
    const claimed = await db
      .collection<Ticket>("tickets")
      .updateMany(
        { _id: { $in: tickets.map((t) => t._id!) }, refundCaseId: null, status: { $ne: "REFUNDED" } },
        { $set: { refundCaseId: caseId } },
        { session },
      );
    if (claimed.modifiedCount !== tickets.length) throw new TxAbort("Those tickets changed — try again.", 409);

    if (morbin) {
      await appendLedger(db, session, [
        {
          organizationId: input.organizationId,
          eventId: order.eventId,
          orderId: refundCase.orderId,
          refundCaseId: caseId,
          type: "REFUND",
          amountPaise: -amountPaise,
          memo: `Refund of ${tickets.length} ticket${tickets.length === 1 ? "" : "s"} (held pending approval)`,
          key: `refund:${caseId}`,
          createdBy: input.requestedBy,
        },
        {
          organizationId: input.organizationId,
          eventId: order.eventId,
          orderId: refundCase.orderId,
          refundCaseId: caseId,
          type: "REFUND_COST",
          amountPaise: -cost.totalPaise,
          memo:
            speed === "INSTANT"
              ? "Razorpay costs: unreturned gateway fee share + instant refund fee"
              : "Razorpay costs: unreturned gateway fee share",
          key: `refund-cost:${caseId}`,
          createdBy: input.requestedBy,
        },
      ]);
    }
    return refundCase;
  });

  await audit({
    actorId: input.requestedBy,
    actorRole: "OWNER",
    action: "refund.requested",
    targetType: "refundCase",
    targetId: created._id!.toString(),
    organizationId: input.organizationId,
    meta: {
      amountPaise: created.amountPaise,
      costPaise: created.cost.totalPaise,
      settledBy: created.settledBy,
      speed: created.speed,
      tickets: created.ticketIds.length,
    },
  });
  await notify({
    organizationId: null,
    audience: "ADMIN",
    kind: "REFUND_REQUESTED",
    title: "Refund awaiting approval",
    body: `${formatINR(created.amountPaise)} for ${created.ticketIds.length} ticket(s).`,
    link: `/dashboard/admin/refunds`,
  });
  return created;
}

/** Reverse a request's hold and free its tickets (inside a transaction). */
async function releaseRequest(db: Db, session: ClientSession, rc: RefundCase, by: string): Promise<void> {
  const caseId = rc._id!.toString();
  await db
    .collection<Ticket>("tickets")
    .updateMany({ refundCaseId: caseId, status: { $ne: "REFUNDED" } }, { $set: { refundCaseId: null } }, { session });
  if (rc.settledBy === "MORBIN") {
    await appendLedger(db, session, [
      {
        organizationId: rc.organizationId,
        eventId: rc.eventId,
        orderId: rc.orderId,
        refundCaseId: caseId,
        type: "REFUND_REVERSAL",
        amountPaise: rc.amountPaise + rc.cost.totalPaise,
        memo: "Refund request withdrawn or rejected — hold released",
        key: `refund-reversal:${caseId}`,
        createdBy: by,
      },
    ]);
  }
}

/** Owner withdraws a request that Morbin has not decided yet. */
export async function cancelRefundRequest(organizationId: string, caseId: string, by: string): Promise<void> {
  await withTransaction(async (session, db) => {
    const rc = await db
      .collection<RefundCase>("refundCases")
      .findOneAndUpdate(
        { _id: caseOid(caseId), organizationId, status: "REQUESTED" },
        { $set: { status: "CANCELLED", updatedAt: new Date() } },
        { session, returnDocument: "after" },
      );
    if (!rc) throw new TxAbort("This refund can no longer be withdrawn.", 409);
    await releaseRequest(db, session, rc, by);
  });
  await audit({
    actorId: by,
    actorRole: "OWNER",
    action: "refund.cancelled",
    targetType: "refundCase",
    targetId: caseId,
    organizationId,
    meta: {},
  });
}

/** Admin rejects a request; the hold is released and tickets stay valid. */
export async function rejectRefund(caseId: string, adminId: string, note: string): Promise<void> {
  const rc = await withTransaction(async (session, db) => {
    const updated = await db.collection<RefundCase>("refundCases").findOneAndUpdate(
      { _id: caseOid(caseId), status: "REQUESTED" },
      {
        $set: {
          status: "REJECTED",
          decidedBy: adminId,
          decisionNote: note.trim() || null,
          decidedAt: new Date(),
          updatedAt: new Date(),
        },
      },
      { session, returnDocument: "after" },
    );
    if (!updated) throw new TxAbort("This refund has already been decided.", 409);
    await releaseRequest(db, session, updated, adminId);
    return updated;
  });
  await audit({
    actorId: adminId,
    actorRole: "ADMIN",
    action: "refund.rejected",
    targetType: "refundCase",
    targetId: caseId,
    organizationId: rc.organizationId,
    meta: { amountPaise: rc.amountPaise },
  });
  await notify({
    organizationId: rc.organizationId,
    audience: "ORG_OWNER",
    kind: "REFUND_REJECTED",
    title: "Refund request rejected",
    body: note.trim() || "Morbin rejected this refund request.",
    link: `/dashboard/refunds`,
  });
}

/**
 * Admin approves: tickets are voided and seats returned in one transaction,
 * then (for Morbin-settled refunds) the refund is sent to Razorpay.
 */
export async function approveRefund(caseId: string, adminId: string, note: string): Promise<RefundCase> {
  const rc = await withTransaction(async (session, db) => {
    const updated = await db.collection<RefundCase>("refundCases").findOneAndUpdate(
      { _id: caseOid(caseId), status: "REQUESTED" },
      {
        $set: {
          status: "APPROVED",
          decidedBy: adminId,
          decisionNote: note.trim() || null,
          decidedAt: new Date(),
          updatedAt: new Date(),
        },
      },
      { session, returnDocument: "after" },
    );
    if (!updated) throw new TxAbort("This refund has already been decided.", 409);

    const tickets = await db
      .collection<Ticket>("tickets")
      .find({ refundCaseId: caseId }, { session })
      .toArray();
    await db
      .collection<Ticket>("tickets")
      .updateMany({ refundCaseId: caseId }, { $set: { status: "REFUNDED" } }, { session });
    const perType = new Map<string, number>();
    for (const t of tickets) perType.set(t.ticketTypeId, (perType.get(t.ticketTypeId) ?? 0) + 1);
    for (const [typeId, n] of perType) {
      const _id = toObjectId(typeId);
      if (_id) await db.collection("ticketTypes").updateOne({ _id }, { $inc: { soldCount: -n } }, { session });
    }

    const orderOid = toObjectId(updated.orderId)!;
    const remaining = await db
      .collection<Ticket>("tickets")
      .countDocuments({ orderId: updated.orderId, status: { $ne: "REFUNDED" } }, { session });
    await db.collection<Order>("orders").updateOne(
      { _id: orderOid },
      {
        $inc: { refundedPaise: updated.amountPaise },
        $set: { status: remaining === 0 ? "REFUNDED" : "PARTIALLY_REFUNDED" },
      },
      { session },
    );

    // Nothing to send: free tickets, or settled by the organisation later.
    if (updated.settledBy === "MORBIN" && updated.amountPaise === 0) {
      await db
        .collection<RefundCase>("refundCases")
        .updateOne(
          { _id: updated._id },
          { $set: { status: "COMPLETED", completedAt: new Date(), completedBy: adminId } },
          { session },
        );
      return { ...updated, status: "COMPLETED" as const };
    }
    return updated;
  });

  await audit({
    actorId: adminId,
    actorRole: "ADMIN",
    action: "refund.approved",
    targetType: "refundCase",
    targetId: caseId,
    organizationId: rc.organizationId,
    meta: { amountPaise: rc.amountPaise, settledBy: rc.settledBy },
  });
  await notify({
    organizationId: rc.organizationId,
    audience: "ORG_OWNER",
    kind: "REFUND_APPROVED",
    title: rc.settledBy === "ORGANISATION" ? "Refund approved — settle it with the customer" : "Refund approved",
    body: `${formatINR(rc.amountPaise)} to ${rc.customer.name}.`,
    link: `/dashboard/refunds`,
  });

  if (rc.settledBy === "MORBIN" && rc.status === "APPROVED") {
    return dispatchRefund(caseId);
  }
  if (rc.settledBy === "ORGANISATION") await queueRefundEmail(rc, "APPROVED_ORG");
  return rc;
}

/**
 * Send an APPROVED (or FAILED, on retry) Morbin-settled refund to Razorpay.
 * Safe to call repeatedly: the case is claimed with a conditional update, and
 * Razorpay is checked for an existing refund for this case before creating one.
 */
export async function dispatchRefund(caseId: string): Promise<RefundCase> {
  const db = await getDb();
  const claimed = await db
    .collection<RefundCase>("refundCases")
    .findOneAndUpdate(
      { _id: caseOid(caseId), settledBy: "MORBIN", status: { $in: ["APPROVED", "FAILED"] } },
      { $set: { status: "PROCESSING", failureReason: null, updatedAt: new Date() } },
      { returnDocument: "after" },
    );
  if (!claimed) throw new TxAbort("This refund isn't waiting to be sent.", 409);
  const order = await db.collection<Order>("orders").findOne({ _id: toObjectId(claimed.orderId)! });
  try {
    if (!order?.razorpayPaymentId) throw new Error("The order has no Razorpay payment.");
    const refund = await refundPayment({
      paymentId: order.razorpayPaymentId,
      amountPaise: claimed.amountPaise,
      speed: claimed.speed === "INSTANT" ? "optimum" : "normal",
      refundCaseId: caseId,
    });
    await db
      .collection<RefundCase>("refundCases")
      .updateOne({ _id: claimed._id }, { $set: { razorpayRefundId: refund.id, updatedAt: new Date() } });
    if (refund.status === "processed" || refund.status === "failed") await applyRefundUpdate(refund);
    else await queueRefundEmail(claimed, "SENT");
  } catch (error) {
    // The Razorpay SDK rejects with `{ statusCode, error: { description } }`, not an Error.
    const rzpError = error as { error?: { description?: string }; statusCode?: number };
    const reason =
      rzpError?.error?.description ??
      (error instanceof Error ? error.message : null) ??
      `Razorpay refund failed${rzpError?.statusCode ? ` (HTTP ${rzpError.statusCode})` : ""}`;
    await db
      .collection<RefundCase>("refundCases")
      .updateOne(
        { _id: claimed._id, status: "PROCESSING" },
        { $set: { status: "FAILED", failureReason: reason, updatedAt: new Date() } },
      );
    console.error("[refunds] dispatch failed", caseId, error);
  }
  return (await db.collection<RefundCase>("refundCases").findOne({ _id: claimed._id }))!;
}

/** Apply a Razorpay refund status (from the webhook or the create response). */
export async function applyRefundUpdate(refund: RazorpayRefund): Promise<void> {
  if (!refund?.id) return;
  const db = await getDb();
  const caseIdFromNotes = refund.notes?.refundCaseId ?? null;
  const rc = await db.collection<RefundCase>("refundCases").findOne(
    caseIdFromNotes && toObjectId(caseIdFromNotes)
      ? { _id: toObjectId(caseIdFromNotes)! }
      : { razorpayRefundId: refund.id },
  );
  if (!rc) return;
  const arn = refund.acquirer_data?.arn ?? refund.acquirer_data?.rrn ?? null;
  if (refund.status === "processed") {
    const r = await db.collection<RefundCase>("refundCases").updateOne(
      { _id: rc._id, status: { $in: ["PROCESSING", "FAILED", "APPROVED"] } },
      {
        $set: {
          status: "COMPLETED",
          razorpayRefundId: refund.id,
          arn,
          failureReason: null,
          completedAt: new Date(),
          updatedAt: new Date(),
        },
      },
    );
    if (r.modifiedCount === 1) {
      await queueRefundEmail({ ...rc, arn }, "COMPLETED");
      await notify({
        organizationId: rc.organizationId,
        audience: "ORG_OWNER",
        kind: "REFUND_COMPLETED",
        title: "Refund completed",
        body: `${formatINR(rc.amountPaise)} returned to ${rc.customer.name}.`,
        link: `/dashboard/refunds`,
      });
    }
  } else if (refund.status === "failed") {
    await db.collection<RefundCase>("refundCases").updateOne(
      { _id: rc._id, status: { $in: ["PROCESSING", "APPROVED"] } },
      {
        $set: {
          status: "FAILED",
          razorpayRefundId: refund.id,
          failureReason: "Razorpay could not complete this refund.",
          updatedAt: new Date(),
        },
      },
    );
    await notify({
      organizationId: null,
      audience: "ADMIN",
      kind: "REFUND_FAILED",
      title: "Refund failed at Razorpay",
      body: `${formatINR(rc.amountPaise)} to ${rc.customer.name} needs manual handling.`,
      link: `/dashboard/admin/refunds`,
    });
  }
}

/** Admin completed a failed refund by bank transfer outside Morbin. */
export async function completeRefundManually(caseId: string, adminId: string, reference: string): Promise<void> {
  const db = await getDb();
  // A refund Razorpay actually processed must never also be paid by hand.
  const current = await db.collection<RefundCase>("refundCases").findOne({ _id: caseOid(caseId) });
  if (current?.razorpayRefundId) {
    const order = await db.collection<Order>("orders").findOne({ _id: toObjectId(current.orderId)! });
    const existing = order?.razorpayPaymentId ? await findRefundForCase(order.razorpayPaymentId, caseId) : null;
    if (existing?.status === "processed") {
      await applyRefundUpdate(existing);
      throw new TxAbort("Razorpay has already processed this refund — no manual payment is needed.", 409);
    }
  }
  const r = await db.collection<RefundCase>("refundCases").updateOne(
    { _id: caseOid(caseId), settledBy: "MORBIN", status: { $in: ["FAILED", "APPROVED"] } },
    {
      $set: {
        status: "COMPLETED_MANUALLY",
        manualReference: reference.trim(),
        completedBy: adminId,
        completedAt: new Date(),
        updatedAt: new Date(),
      },
    },
  );
  if (r.modifiedCount === 0) throw new TxAbort("This refund can't be completed manually now.", 409);
  await audit({
    actorId: adminId,
    actorRole: "ADMIN",
    action: "refund.completed_manually",
    targetType: "refundCase",
    targetId: caseId,
    organizationId: current?.organizationId ?? null,
    meta: { reference: reference.trim() },
  });
  if (current) await queueRefundEmail(current, "COMPLETED");
}

/** Owner records that the organisation refunded an approved self-settled case. */
export async function markSettledByOrg(
  organizationId: string,
  caseId: string,
  by: string,
  reference: string,
): Promise<void> {
  const db = await getDb();
  const r = await db.collection<RefundCase>("refundCases").updateOne(
    { _id: caseOid(caseId), organizationId, settledBy: "ORGANISATION", status: "APPROVED" },
    {
      $set: {
        status: "COMPLETED_BY_ORG",
        manualReference: reference.trim(),
        completedBy: by,
        completedAt: new Date(),
        updatedAt: new Date(),
      },
    },
  );
  if (r.modifiedCount === 0) throw new TxAbort("This refund isn't waiting for your settlement.", 409);
  await audit({
    actorId: by,
    actorRole: "OWNER",
    action: "refund.settled_by_org",
    targetType: "refundCase",
    targetId: caseId,
    organizationId,
    meta: { reference: reference.trim() },
  });
}

/** Customer email for a refund milestone. Never mentions the convenience fee as refundable. */
async function queueRefundEmail(
  rc: RefundCase,
  stage: "SENT" | "COMPLETED" | "APPROVED_ORG",
): Promise<void> {
  const db = await getDb();
  const event = await db
    .collection("events")
    .findOne({ _id: toObjectId(rc.eventId)! }, { projection: { title: 1 } });
  await db.collection<EmailRecord>("emailDeliveries").updateOne(
    { kind: "REFUND", orderId: rc.orderId, "meta.ticketCode": `${rc._id!.toString()}:${stage}` },
    {
      $setOnInsert: {
        orderId: rc.orderId,
        ticketId: null,
        recipient: rc.customer.email,
        kind: "REFUND",
        status: "QUEUED",
        attempts: 0,
        lastError: null,
        meta: {
          eventTitle: (event?.title as string) ?? "your event",
          attendeeName: rc.customer.name,
          // ticketCode doubles as the idempotency key for this email.
          ticketCode: `${rc._id!.toString()}:${stage}`,
          refundAmountPaise: rc.amountPaise,
          refundStage: stage,
          refundArn: rc.arn,
          refundSpeed: rc.speed,
        },
      },
    },
    { upsert: true },
  );
}

/** Open refund cases (for listing and for blocking double requests). */
export function isOpenRefund(status: RefundCase["status"]): boolean {
  return OPEN.includes(status);
}
