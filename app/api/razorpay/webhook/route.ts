import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { flushEmailQueue } from "@/lib/email";
import {
  createOrganizerTransfer,
  fetchPayment,
  verifyWebhookSignature,
} from "@/lib/razorpay";
import { makeTicketCode, signTicket, ticketQrSvg } from "@/lib/tickets";
import type { EmailRecord, Event, Order, Ticket, WebhookRecord } from "@/lib/types";

export const runtime = "nodejs";

async function releaseHold(
  db: Awaited<ReturnType<typeof getDb>>,
  items: { ticketTypeId: string; quantity: number }[],
) {
  const { ObjectId } = await import("mongodb");
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

export async function POST(request: Request) {
  const raw = await request.text();
  const signature = request.headers.get("x-razorpay-signature") ?? "";
  if (!verifyWebhookSignature(raw, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const event = JSON.parse(raw) as {
    id?: string;
    event: string;
    payload?: {
      payment?: { entity?: Record<string, unknown> };
      order?: { entity?: Record<string, unknown> };
      refund?: { entity?: Record<string, unknown> };
    };
  };
  const db = await getDb();

  // Idempotency: one record per Razorpay event id.
  if (event.id) {
    try {
      await db.collection<WebhookRecord>("razorpayWebhooks").insertOne({
        providerEventId: event.id,
        eventType: event.event,
        status: "RECEIVED",
      });
    } catch {
      return NextResponse.json({ received: true, duplicate: true });
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
        (event.payload?.payment?.entity as Record<string, unknown> | undefined) ?? {};
      const paymentId = String(entity.id ?? "");
      const rzpOrderId = String(entity.order_id ?? "");
      if (!paymentId || !rzpOrderId) {
        await mark("FAILED");
        return NextResponse.json({ error: "Bad payload" }, { status: 400 });
      }

      // Re-verify against Razorpay API; never trust the webhook amount.
      const payment = await fetchPayment(paymentId);
      if (!payment.captured || payment.order_id !== rzpOrderId) {
        await mark("FAILED");
        return NextResponse.json({ error: "Payment not captured" }, { status: 400 });
      }

      const order = await db.collection<Order>("orders").findOne({ razorpayOrderId: rzpOrderId });
      if (!order) {
        await mark("FAILED");
        return NextResponse.json({ error: "Unknown order" }, { status: 404 });
      }
      if (order.status === "PAID") {
        await mark("PROCESSED");
        return NextResponse.json({ received: true, duplicate: true });
      }
      if (payment.amount !== order.totalPaise || payment.currency !== order.currency) {
        await db
          .collection("orders")
          .updateOne({ _id: order._id }, { $set: { status: "FAILED" } });
        await releaseHold(db, order.items);
        await mark("FAILED");
        return NextResponse.json({ error: "Amount mismatch" }, { status: 400 });
      }

      // Fulfill: mark paid, create tickets, queue emails.
      await db.collection("orders").updateOne(
        { _id: order._id },
        { $set: { status: "PAID", razorpayPaymentId: paymentId, paidAt: new Date() } },
      );

      const ev = await db.collection<Event>("events").findOne({ _id: order.eventId as never });
      void ev;
      const { ObjectId: OID } = await import("mongodb");
      const eventDoc = await db
        .collection<Event>("events")
        .findOne({ _id: new OID(order.eventId) });
      // Attendee pool per ticket type (fallback: buyer details).
      const pools = new Map<string, { name: string; email: string }[]>();
      for (const a of order.attendees ?? []) {
        const list = pools.get(a.ticketTypeId) ?? [];
        list.push({ name: a.name, email: a.email });
        pools.set(a.ticketTypeId, list);
      }
      const tickets: Ticket[] = [];
      for (const item of order.items) {
        const pool = pools.get(item.ticketTypeId) ?? [];
        for (let i = 0; i < item.quantity; i++) {
          const attendee = pool[i] ?? { name: order.buyerName, email: order.buyerEmail };
          const code = makeTicketCode();
          tickets.push({
            orderId: order._id!.toString(),
            eventId: order.eventId,
            ticketTypeId: item.ticketTypeId,
            attendeeName: attendee.name,
            attendeeEmail: attendee.email,
            code,
            qrPayload: signTicket(code),
            status: "VALID",
            checkedInAt: null,
          });
        }
      }
      const inserted =
        tickets.length > 0
          ? await db.collection<Ticket>("tickets").insertMany(tickets)
          : null;

      const emailDocs: EmailRecord[] = [];
      if (inserted) {
        const ids = Object.values(inserted.insertedIds);
        const qrCache = new Map<string, string | null>();
        for (let i = 0; i < tickets.length; i++) {
          const t = tickets[i];
          if (!qrCache.has(t.qrPayload)) qrCache.set(t.qrPayload, await ticketQrSvg(t.qrPayload));
          emailDocs.push({
            orderId: order._id!.toString(),
            ticketId: ids[i]?.toString() ?? null,
            recipient: t.attendeeEmail,
            kind: "TICKET",
            status: "QUEUED",
            attempts: 0,
            lastError: null,
            meta: {
              eventTitle: eventDoc?.title ?? "Your event",
              eventVenue: eventDoc?.venue ?? "",
              eventStartsAt: eventDoc?.startsAt?.toISOString() ?? "",
              attendeeName: t.attendeeName,
              ticketCode: t.code,
              qrSvg: qrCache.get(t.qrPayload) ?? null,
            },
          });
        }
        await db.collection("emailDeliveries").insertMany(emailDocs);
      }

      // Automatic organizer settlement (non-fatal to fulfillment).
      try {
        const { ObjectId: OrgOID } = await import("mongodb");
        const orgDoc = await db
          .collection<{ razorpayAccountId?: string }>("organizations")
          .findOne({ _id: new OrgOID(order.organizationId) });
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
          await releaseHold(db, order.items);
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
