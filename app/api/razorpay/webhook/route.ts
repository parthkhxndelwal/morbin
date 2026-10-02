import { NextResponse } from "next/server";
import { audit, notify } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { flushEmailQueue } from "@/lib/email";
import { capturePaidOrder, releaseOrder } from "@/lib/orders";
import { fetchPayment, verifyWebhookSignature, type RazorpayRefund } from "@/lib/razorpay";
import { applyRefundUpdate } from "@/lib/refunds";
import type { Order, WebhookRecord } from "@/lib/types";

export const runtime = "nodejs";

type Entity = Record<string, unknown>;

/**
 * Razorpay webhooks: payment captured/failed and refund processed/failed.
 *
 * The signature is checked over the raw body, and the payment is re-fetched
 * from Razorpay rather than trusting the payload. Every handler is idempotent
 * (state transitions are conditional), so Razorpay's retries are harmless; a
 * 5xx is returned only for conditions a retry can fix.
 */
export async function POST(request: Request) {
  const raw = await request.text();
  const signature = request.headers.get("x-razorpay-signature") ?? "";
  if (!verifyWebhookSignature(raw, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let event: {
    id?: string;
    event: string;
    payload?: {
      payment?: { entity?: Entity };
      order?: { entity?: Entity };
      refund?: { entity?: Entity };
    };
  };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const db = await getDb();
  const eventId = request.headers.get("x-razorpay-event-id") ?? event.id ?? null;

  if (eventId) {
    const prior = await db
      .collection<WebhookRecord>("razorpayWebhooks")
      .findOneAndUpdate(
        { providerEventId: eventId },
        { $setOnInsert: { providerEventId: eventId, eventType: event.event, status: "RECEIVED" } },
        { upsert: true, returnDocument: "before" },
      );
    if (prior?.status === "PROCESSED") return NextResponse.json({ received: true, duplicate: true });
  }
  const mark = async (status: WebhookRecord["status"]) => {
    if (!eventId) return;
    await db
      .collection<WebhookRecord>("razorpayWebhooks")
      .updateOne({ providerEventId: eventId }, { $set: { status, processedAt: new Date() } });
  };

  try {
    if (event.event === "payment.captured" || event.event === "order.paid") {
      const payment = event.payload?.payment?.entity ?? {};
      const paymentId = String(payment.id ?? "");
      if (!paymentId) {
        await mark("FAILED");
        return NextResponse.json({ error: "Bad payload" }, { status: 400 });
      }
      // Never trust the webhook body for money: re-read the payment.
      const verified = await fetchPayment(paymentId);
      if (!verified.captured || !verified.order_id) {
        await mark("PROCESSED");
        return NextResponse.json({ received: true, ignored: "not captured" });
      }
      const result = await capturePaidOrder({
        razorpayOrderId: verified.order_id,
        paymentId,
        amountPaise: verified.amount,
        currency: verified.currency,
        gatewayFeePaise: verified.fee ?? 0,
        gatewayTaxPaise: verified.tax ?? 0,
        method: verified.method ?? null,
      });

      if (result.status === "unknown_order") {
        // The order write may still be in flight; let Razorpay retry.
        await mark("FAILED");
        return NextResponse.json({ error: "Unknown order — retrying" }, { status: 500 });
      }
      if (result.status === "mismatch" || result.status === "ignored") {
        // Money was captured but cannot be honoured (amount mismatch, or the
        // seat hold had already lapsed). An admin must refund it.
        const order = result.status === "mismatch" ? result.order : null;
        await notify({
          organizationId: null,
          audience: "ADMIN",
          kind: "PAYMENT_NEEDS_REFUND",
          title: "Captured payment needs a refund",
          body: `Payment ${paymentId} for Razorpay order ${verified.order_id} could not be fulfilled (${
            result.status === "mismatch" ? "amount mismatch" : result.reason
          }).`,
          link: null,
        });
        await audit({
          actorId: null,
          actorRole: "SYSTEM",
          action: "payment.unfulfillable",
          targetType: "order",
          targetId: order?._id?.toString() ?? null,
          organizationId: order?.organizationId ?? null,
          meta: { paymentId, razorpayOrderId: verified.order_id, amountPaise: verified.amount },
        });
        await mark("PROCESSED");
        return NextResponse.json({ received: true, needsRefund: true });
      }

      await mark("PROCESSED");
      try {
        await flushEmailQueue(20);
      } catch (err) {
        console.error("[webhook] email flush failed", err);
      }
      return NextResponse.json({ received: true });
    }

    if (event.event === "payment.failed") {
      const payment = event.payload?.payment?.entity ?? {};
      const razorpayOrderId = String(payment.order_id ?? "");
      if (razorpayOrderId) {
        const order = await db.collection<Order>("orders").findOne({ razorpayOrderId });
        if (order?.status === "CREATED") await releaseOrder(order._id!, "FAILED");
      }
      await mark("PROCESSED");
      return NextResponse.json({ received: true });
    }

    if (event.event === "refund.processed" || event.event === "refund.failed") {
      const refund = (event.payload?.refund?.entity ?? {}) as unknown as RazorpayRefund;
      await applyRefundUpdate(refund);
      await mark("PROCESSED");
      return NextResponse.json({ received: true });
    }

    await mark("PROCESSED");
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[razorpay/webhook]", error);
    await mark("FAILED");
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }
}
