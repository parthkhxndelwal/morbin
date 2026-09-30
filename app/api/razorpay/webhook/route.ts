import { NextResponse } from "next/server";
import { getDb, toObjectId } from "@/lib/db";
import { flushEmailQueue } from "@/lib/email";
import { fulfillOrderTickets } from "@/lib/fulfillment";
import { releaseInventoryHold } from "@/lib/orders";
import {
  createOrganizerTransfer,
  fetchPayment,
  verifyWebhookSignature,
} from "@/lib/razorpay";
import type { Event, Order, WebhookRecord } from "@/lib/types";

export const runtime = "nodejs";

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
      payment?: { entity?: Record<string, unknown> };
      order?: { entity?: Record<string, unknown> };
      refund?: { entity?: Record<string, unknown> };
    };
  };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const db = await getDb();

  // Idempotency: one record per Razorpay event id. Unlike the old code (which
  // returned duplicate:true on ANY conflict and swallowed retries), only
  // PROCESSED records short-circuit — RECEIVED/FAILED records are reprocessed
  // so transient failures (e.g. order-write race) recover on Razorpay retry.
  if (event.id) {
    try {
      await db.collection<WebhookRecord>("razorpayWebhooks").insertOne({
        providerEventId: event.id,
        eventType: event.event,
        status: "RECEIVED",
      });
    } catch {
      const existing = event.id
        ? await db
            .collection<WebhookRecord>("razorpayWebhooks")
            .findOne({ providerEventId: event.id })
        : null;
      if (existing?.status === "PROCESSED") {
        return NextResponse.json({ received: true, duplicate: true });
      }
      // Otherwise fall through and reprocess this delivery attempt.
    }
  }
  const mark = async (status: WebhookRecord["status"]) => {
    if (event.id)
      await db
        .collection("razorpayWebhooks")
        .updateOne(
          { providerEventId: event.id },
          { $set: { status, processedAt: new Date() } },
        );
  };

  try {
    if (event.event === "payment.captured" || event.event === "order.paid") {
      const entity =
        event.event === "order.paid"
          ? ((event.payload?.order?.entity ??
            event.payload?.payment?.entity) as Record<string, unknown> | undefined) ?? {}
          : ((event.payload?.payment?.entity as Record<string, unknown> | undefined) ?? {});
      const paymentId = String(entity.id ?? "");
      // order.paid payloads nest the payment id under `payments[]` in some
      // versions — fall back to the first entry when `id` is absent.
      const payments = Array.isArray(entity.payments) ? entity.payments : [];
      const fallbackPaymentId =
        !paymentId && payments.length > 0 ? String((payments[0] as Record<string, unknown>).id ?? "") : "";
      const resolvedPaymentId = paymentId || fallbackPaymentId;
      const rzpOrderId = String(entity.order_id ?? "");
      if (!resolvedPaymentId || !rzpOrderId) {
        await mark("FAILED");
        return NextResponse.json({ error: "Bad payload" }, { status: 400 });
      }

      // Re-verify against Razorpay API; never trust the webhook amount.
      const payment = await fetchPayment(resolvedPaymentId);
      if (!payment.captured || payment.order_id !== rzpOrderId) {
        await mark("FAILED");
        return NextResponse.json({ error: "Payment not captured" }, { status: 400 });
      }

      const order = await db.collection<Order>("orders").findOne({ razorpayOrderId: rzpOrderId });
      if (!order) {
        // Retryable: the order write may still be in flight. Return 500 (not
        // 200-duplicate) so Razorpay redelivers; the RECEIVED record stays and
        // the next attempt reprocesses instead of short-circuiting.
        await mark("FAILED");
        return NextResponse.json({ error: "Unknown order — retrying" }, { status: 500 });
      }
      if (order.status === "PAID") {
        await mark("PROCESSED");
        return NextResponse.json({ received: true, duplicate: true });
      }
      if (order.status !== "CREATED") {
        await mark("PROCESSED");
        return NextResponse.json({ received: true });
      }
      if (payment.amount !== order.totalPaise || payment.currency !== order.currency) {
        await db
          .collection("orders")
          .updateOne({ _id: order._id }, { $set: { status: "FAILED" } });
        await releaseInventoryHold(db, order.items);
        await mark("FAILED");
        return NextResponse.json({ error: "Amount mismatch" }, { status: 400 });
      }

      // Validate all ids BEFORE mutating the order so a malformed order can
      // never be left PAID with zero tickets (the old ObjectId throw did that).
      const eventOid = toObjectId(order.eventId);
      const orgOid = toObjectId(order.organizationId);
      if (!eventOid) {
        await db
          .collection("orders")
          .updateOne({ _id: order._id }, { $set: { status: "FAILED" } });
        await releaseInventoryHold(db, order.items);
        await mark("FAILED");
        return NextResponse.json({ error: "Corrupt order" }, { status: 400 });
      }
      const eventDoc = await db.collection<Event>("events").findOne({ _id: eventOid });

      // Fulfill: mark paid, create tickets (idempotent), queue emails.
      await db.collection("orders").updateOne(
        { _id: order._id },
        { $set: { status: "PAID", razorpayPaymentId: resolvedPaymentId, paidAt: new Date() } },
      );

      try {
        await fulfillOrderTickets({ ...order, _id: order._id }, eventDoc);
      } catch (err) {
        // Tickets failed but payment is real: keep PAID (never auto-release a
        // captured payment's inventory) and let the next redelivery / cron
        // backfill. fulfillOrderTickets is idempotent via orderId check.
        console.error("[webhook] fulfillment failed, will retry", err);
        await mark("FAILED");
        return NextResponse.json({ error: "Fulfillment failed — retrying" }, { status: 500 });
      }

      // Automatic organizer settlement (non-fatal to fulfillment).
      try {
        if (orgOid) {
          const orgDoc = await db
            .collection<{ razorpayAccountId?: string }>("organizations")
            .findOne({ _id: orgOid });
          if (orgDoc?.razorpayAccountId && order.organizerAmountPaise > 0) {
            const transfer = await createOrganizerTransfer({
              account: orgDoc.razorpayAccountId,
              amountPaise: order.organizerAmountPaise,
              notes: {
                orderId: order._id!.toString(),
                eventId: order.eventId,
                organizationId: order.organizationId,
              },
            });
            await db.collection("orders").updateOne(
              { _id: order._id },
              { $set: { transferId: transfer.id, transferStatus: transfer.status } },
            );
          }
        }
      } catch (err) {
        console.error("[webhook] transfer failed", err);
        await db
          .collection("orders")
          .updateOne({ _id: order._id }, { $set: { transferStatus: "FAILED" } });
      }

      await mark("PROCESSED");
      // Deliver queued ticket emails inline (bounded); cron re-runs failures.
      try {
        await flushEmailQueue(20);
      } catch (err) {
        console.error("[webhook] email flush failed", err);
      }
      return NextResponse.json({ received: true });
    }

    if (event.event === "payment.failed") {
      const entity =
        (event.payload?.payment?.entity as Record<string, unknown> | undefined) ?? {};
      const rzpOrderId = String(entity.order_id ?? "");
      if (rzpOrderId) {
        const order = await db
          .collection<Order>("orders")
          .findOne({ razorpayOrderId: rzpOrderId });
        if (order && order.status === "CREATED") {
          await db
            .collection("orders")
            .updateOne({ _id: order._id }, { $set: { status: "FAILED" } });
          await releaseInventoryHold(db, order.items);
        }
      }
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
