import { NextResponse } from "next/server";
import { getDb, toObjectId } from "@/lib/db";
import { ORDER_HOLD_MS } from "@/lib/orders";
import type { Order } from "@/lib/types";

/** Order status polling for checkout completion UI. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const _id = toObjectId(id);
  if (!_id) return NextResponse.json({ error: "Invalid order" }, { status: 400 });
  const db = await getDb();
  const order = await db.collection<Order>("orders").findOne({ _id });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Lazy-expiry so the checkout UI stops polling holds that the cron hasn't
  // reaped yet. Best-effort inventory release, non-fatal to the poll.
  if (
    order.status === "CREATED" &&
    Date.now() - new Date(order.createdAt).getTime() > ORDER_HOLD_MS
  ) {
    try {
      const { expireStaleOrders } = await import("@/lib/orders");
      await expireStaleOrders();
      const fresh = await db.collection<Order>("orders").findOne({ _id });
      if (fresh)
        return NextResponse.json({
          status: fresh.status,
          totalPaise: fresh.totalPaise,
          eventId: fresh.eventId,
        });
    } catch {
      /* fall through with stale status */
    }
  }
  return NextResponse.json({
    status: order.status,
    totalPaise: order.totalPaise,
    eventId: order.eventId,
  });
}
