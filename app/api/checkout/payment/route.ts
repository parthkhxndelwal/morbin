import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { CHECKOUT_COOKIE, getSessionByResumeToken } from "@/lib/checkout";
import { getDb, toObjectId } from "@/lib/db";
import type { Order } from "@/lib/types";

/**
 * Hands the drawer everything Razorpay needs, and nothing more.
 *
 * The amount, the order id and the key all come from the stored order — never
 * from the client. Appearance is intentionally absent: the checkout's look is
 * configured in the Razorpay dashboard, so this app only supplies context.
 */
export async function GET() {
  const jar = await cookies();
  const session = await getSessionByResumeToken(jar.get(CHECKOUT_COOKIE)?.value);
  if (!session?.orderId) {
    return NextResponse.json({ error: "No order to pay for" }, { status: 404 });
  }

  const db = await getDb();
  const order = await db
    .collection<Order>("orders")
    .findOne({ _id: toObjectId(session.orderId) as never });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  // Only a live order can be paid. A free order has no Razorpay counterpart and
  // was fulfilled the moment it was created.
  if (order.status !== "CREATED" || order.razorpayOrderId.startsWith("pending-")) {
    return NextResponse.json({ error: "This order is not awaiting payment" }, { status: 409 });
  }
  if (!process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID) {
    return NextResponse.json({ error: "Payments are not configured" }, { status: 503 });
  }

  return NextResponse.json({
    orderId: order._id!.toString(),
    razorpayOrderId: order.razorpayOrderId,
    keyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
    amountPaise: order.pricing?.orderTotalPaise ?? order.totalPaise,
    currency: order.currency,
    // Prefill is context, not customisation: it tells Razorpay which buyer this
    // payment belongs to so the receipt matches the verified email.
    prefill: { name: order.buyerName, email: order.buyerEmail },
    description: "Morbin tickets",
  });
}

/** Poll the order's settlement state while Razorpay is open. */
export async function PATCH() {
  const jar = await cookies();
  const session = await getSessionByResumeToken(jar.get(CHECKOUT_COOKIE)?.value);
  if (!session?.orderId) {
    return NextResponse.json({ error: "No order" }, { status: 404 });
  }
  const db = await getDb();
  const order = await db
    .collection<Order>("orders")
    .findOne({ _id: toObjectId(session.orderId) as never });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  return NextResponse.json({ status: order.status, orderId: order._id!.toString() });
}
