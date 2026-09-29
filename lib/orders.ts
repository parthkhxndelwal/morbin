import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import type { Order } from "@/lib/types";

/** How long a CREATED order holds inventory before it expires. */
export const ORDER_HOLD_MS = 15 * 60 * 1000;

async function releaseHold(
  db: Awaited<ReturnType<typeof getDb>>,
  items: { ticketTypeId: string; quantity: number }[],
) {
  for (const item of items) {
    try {
      await db
        .collection("ticketTypes")
        .updateOne(
          { _id: new ObjectId(item.ticketTypeId) },
          { $inc: { soldCount: -item.quantity } },
        );
    } catch {
      /* best effort */
    }
  }
}

/**
 * Expire stale CREATED orders and release their inventory holds.
 * Safe to run repeatedly (only touches CREATED orders older than the cutoff).
 * Returns the number of orders expired.
 */
export async function expireStaleOrders(now = new Date()): Promise<number> {
  const db = await getDb();
  const cutoff = new Date(now.getTime() - ORDER_HOLD_MS);
  const stale = await db
    .collection<Order>("orders")
    .find({ status: "CREATED", createdAt: { $lt: cutoff } })
    .project({ _id: 1, items: 1 })
    .limit(100)
    .toArray();
  let expired = 0;
  for (const order of stale) {
    const r = await db
      .collection<Order>("orders")
      .updateOne(
        { _id: order._id, status: "CREATED" },
        { $set: { status: "EXPIRED" } },
      );
    if (r.modifiedCount === 1) {
      await releaseHold(db, order.items ?? []);
      expired++;
    }
  }
  return expired;
}
