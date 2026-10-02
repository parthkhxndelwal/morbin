import { ObjectId, type ClientSession, type Db } from "mongodb";
import { getDb, toObjectId } from "@/lib/db";
import { insertTicketsOnce, queueTicketEmails } from "@/lib/fulfillment";
import { appendLedger, saleEntries } from "@/lib/ledger";
import { insertClaims, releaseClaims } from "@/lib/lookups";
import { TxAbort, withTransaction } from "@/lib/tx";
import type { Event, Order, Ticket } from "@/lib/types";

/**
 * The order lifecycle, with every money/inventory transition in a transaction:
 *
 *   createHeldOrder   seats held + order inserted (CREATED, or PAID if free)
 *   capturePaidOrder  CREATED → PAID + tickets + ledger, then emails
 *   releaseOrder      CREATED → EXPIRED / FAILED + seats released
 *
 * Conditional updates on `status` make each transition happen at most once,
 * however many times a webhook or cron retries it.
 */

/** How long a CREATED order holds inventory before it expires. */
export const ORDER_HOLD_MS = 15 * 60 * 1000;

async function adjustSeats(
  db: Db,
  session: ClientSession,
  items: readonly { ticketTypeId: string; quantity: number }[],
  direction: 1 | -1,
): Promise<void> {
  for (const item of items) {
    const _id = toObjectId(item.ticketTypeId);
    if (!_id) throw new TxAbort("Invalid ticket type");
    if (direction === 1) {
      const r = await db.collection("ticketTypes").updateOne(
        { _id, $expr: { $lte: [{ $add: ["$soldCount", item.quantity] }, "$capacity"] } },
        { $inc: { soldCount: item.quantity } },
        { session },
      );
      if (r.matchedCount === 0) throw new TxAbort("Sorry, those tickets just sold out.", 409);
    } else {
      await db
        .collection("ticketTypes")
        .updateOne({ _id }, { $inc: { soldCount: -item.quantity } }, { session });
    }
  }
}

/**
 * Hold seats and insert the order, atomically. A free order is inserted PAID
 * with its tickets in the same transaction. Throws TxAbort (e.g. sold out) with
 * nothing written.
 */
export async function createHeldOrder(order: Order): Promise<{ order: Order; tickets: Ticket[] }> {
  if (!order._id) order._id = new ObjectId();
  const free = (order.pricing?.orderTotalPaise ?? order.totalPaise) === 0;
  const result = await withTransaction(async (session, db) => {
    await adjustSeats(db, session, order.items, 1);
    await insertClaims(db, session, order);
    const doc: Order = free ? { ...order, status: "PAID", paidAt: new Date() } : order;
    await db.collection<Order>("orders").insertOne(doc, { session });
    const tickets = free ? await insertTicketsOnce(db, session, doc) : [];
    return { order: doc, tickets };
  });
  if (free) await queueTicketEmails(result.order, await getEvent(order.eventId), result.tickets);
  return result;
}

async function getEvent(eventId: string): Promise<Event | null> {
  const _id = toObjectId(eventId);
  if (!_id) return null;
  const db = await getDb();
  return db.collection<Event>("events").findOne({ _id });
}

/**
 * Move a CREATED order to EXPIRED or FAILED and give its seats back. Returns
 * false if the order was not CREATED (already paid, already released).
 */
export async function releaseOrder(orderId: ObjectId, to: "EXPIRED" | "FAILED"): Promise<boolean> {
  return withTransaction(async (session, db) => {
    const order = await db
      .collection<Order>("orders")
      .findOneAndUpdate({ _id: orderId, status: "CREATED" }, { $set: { status: to } }, { session });
    if (!order) return false;
    await adjustSeats(db, session, order.items, -1);
    await releaseClaims(db, session, orderId.toString());
    return true;
  });
}

/** Expire stale CREATED orders. Safe to run repeatedly; returns how many it expired. */
export async function expireStaleOrders(now = new Date()): Promise<number> {
  const db = await getDb();
  const cutoff = new Date(now.getTime() - ORDER_HOLD_MS);
  const stale = await db
    .collection<Order>("orders")
    .find({ status: "CREATED", createdAt: { $lt: cutoff } }, { projection: { _id: 1 } })
    .limit(200)
    .toArray();
  let expired = 0;
  for (const o of stale) {
    try {
      if (await releaseOrder(o._id!, "EXPIRED")) expired++;
    } catch (error) {
      console.error("[orders] expire failed", o._id?.toString(), error);
    }
  }
  return expired;
}

export type CaptureResult =
  | { status: "captured"; order: Order }
  | { status: "duplicate"; order: Order }
  | { status: "ignored"; reason: string }
  | { status: "mismatch"; order: Order }
  | { status: "unknown_order" };

/**
 * Record a verified, captured Razorpay payment against its order.
 *
 * In one transaction: CREATED → PAID, tickets inserted, ledger credited. The
 * amount must equal the order's frozen total, or the order fails and releases
 * its seats (Razorpay's captured money is then refunded by an admin). Emails
 * are queued only after commit.
 */
export async function capturePaidOrder(input: {
  razorpayOrderId: string;
  paymentId: string;
  amountPaise: number;
  currency: string;
  /** Razorpay's fee for this payment, including tax. */
  gatewayFeePaise: number;
  gatewayTaxPaise: number;
  method: string | null;
}): Promise<CaptureResult> {
  const db = await getDb();
  const existing = await db.collection<Order>("orders").findOne({ razorpayOrderId: input.razorpayOrderId });
  if (!existing) return { status: "unknown_order" };
  if (existing.status === "PAID" || existing.status === "REFUNDED" || existing.status === "PARTIALLY_REFUNDED") {
    return { status: "duplicate", order: existing };
  }
  if (existing.status !== "CREATED") {
    // EXPIRED/FAILED: the hold lapsed before the payment landed. The money is
    // real, so this is surfaced for an admin to refund rather than silently kept.
    return { status: "ignored", reason: `order is ${existing.status}` };
  }
  const expected = existing.pricing?.orderTotalPaise ?? existing.totalPaise;
  if (input.amountPaise !== expected || input.currency !== existing.currency) {
    await releaseOrder(existing._id!, "FAILED");
    return { status: "mismatch", order: existing };
  }

  const paidAt = new Date();
  const outcome = await withTransaction(async (session, txDb) => {
    const order = await txDb.collection<Order>("orders").findOneAndUpdate(
      { _id: existing._id, status: "CREATED" },
      {
        $set: {
          status: "PAID",
          paidAt,
          razorpayPaymentId: input.paymentId,
          gateway: {
            feePaise: input.gatewayFeePaise,
            taxPaise: input.gatewayTaxPaise,
            method: input.method,
          },
        },
      },
      { session, returnDocument: "after" },
    );
    if (!order) return null; // a concurrent capture won
    const tickets = await insertTicketsOnce(txDb, session, order);
    await appendLedger(txDb, session, saleEntries(order, null));
    if (order.checkoutSessionId) {
      await txDb
        .collection("checkoutSessions")
        .updateOne(
          { publicId: order.checkoutSessionId },
          { $set: { status: "COMPLETED", orderId: order._id!.toString(), updatedAt: paidAt } },
          { session },
        );
    }
    return { order, tickets };
  });

  if (!outcome) {
    const now = await db.collection<Order>("orders").findOne({ _id: existing._id });
    return { status: "duplicate", order: now ?? existing };
  }
  await queueTicketEmails(outcome.order, await getEvent(outcome.order.eventId), outcome.tickets);
  return { status: "captured", order: outcome.order };
}
