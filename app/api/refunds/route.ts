import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { refundPayment } from "@/lib/razorpay";
import type { Order, Ticket } from "@/lib/types";

const schema = z.object({ orderId: z.string().min(1) });

function oid(id: string): ObjectId | null {
  try {
    return new ObjectId(id);
  } catch {
    return null;
  }
}

/** Owner-only full refund: reverses transfer, refunds payment, voids tickets. */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid order" }, { status: 400 });
  const _id = oid(parsed.data.orderId);
  if (!_id) return NextResponse.json({ error: "Invalid order" }, { status: 400 });

  const db = await getDb();
  const order = await db.collection<Order>("orders").findOne({ _id });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (order.status !== "PAID")
    return NextResponse.json({ error: "Only paid orders can be refunded" }, { status: 400 });

  const membership = await db.collection("memberships").findOne({
    organizationId: order.organizationId,
    userId: session.user.id,
    role: "OWNER",
  });
  if (!membership)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!order.razorpayPaymentId)
    return NextResponse.json({ error: "No payment to refund" }, { status: 400 });

  try {
    // Atomic claim: only one concurrent request can move PAID -> REFUNDED.
    // The Razorpay call happens after the claim; on failure we revert to PAID.
    const claimed = await db
      .collection<Order>("orders")
      .updateOne({ _id, status: "PAID" }, { $set: { status: "REFUNDED" } });
    if (claimed.modifiedCount === 0) {
      const current = await db.collection<Order>("orders").findOne({ _id });
      if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });
      if (current.status === "REFUNDED")
        return NextResponse.json({ error: "Order already refunded" }, { status: 409 });
      return NextResponse.json({ error: "Only paid orders can be refunded" }, { status: 400 });
    }
    let refundId: string | null = null;
    try {
      const refund = await refundPayment(order.razorpayPaymentId, order.totalPaise, true);
      refundId = refund.id ?? null;
    } catch (error) {
      // Revert the claim so the order can be retried.
      await db
        .collection<Order>("orders")
        .updateOne({ _id, status: "REFUNDED" }, { $set: { status: "PAID" } });
      console.error("[refunds]", error);
      return NextResponse.json({ error: "Refund failed at Razorpay" }, { status: 502 });
    }
    if (refundId) {
      await db
        .collection<Order>("orders")
        .updateOne({ _id }, { $set: { razorpayRefundId: refundId } });
    }
  } catch (error) {
    console.error("[refunds]", error);
    return NextResponse.json({ error: "Refund failed" }, { status: 500 });
  }
  await db
    .collection<Ticket>("tickets")
    .updateMany({ orderId: order._id!.toString() }, { $set: { status: "REFUNDED" } });
  for (const item of order.items) {
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
  await db.collection("emailDeliveries").insertOne({
    orderId: order._id!.toString(),
    ticketId: null,
    recipient: order.buyerEmail,
    kind: "REFUND",
    status: "QUEUED",
    attempts: 0,
    lastError: null,
    meta: null,
  });
  return NextResponse.json({ ok: true });
}
