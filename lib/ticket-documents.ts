import "server-only";

import { getDb, safeObjectIds, toObjectId } from "@/lib/db";
import { getDocument, readDocumentBody, storeDocument } from "@/lib/documents";
import { issueCustomerInvoice } from "@/lib/invoices";
import { buildTicketPdf } from "@/lib/ticket-pdf";
import type { Event, Order, Organization, Ticket, TicketType } from "@/lib/types";

/**
 * The ticket PDF for an order: built once (issuing the fee invoice on the way
 * if one is due), stored immutably in the private document store, and read back
 * for every later email or download. Called when the ticket email is sent, not
 * at payment capture, so a failure here is retried by the email queue and can
 * never undo a payment.
 */

export interface TicketDocument {
  fileName: string;
  body: Buffer;
}

function slugForFile(title: string): string {
  return title.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "tickets";
}

export async function getOrderTicketPdf(orderId: string): Promise<TicketDocument | null> {
  const db = await getDb();
  const _id = toObjectId(orderId);
  if (!_id) return null;
  const order = await db.collection<Order>("orders").findOne({ _id });
  if (!order) return null;

  if (order.ticketPdfDocId) {
    const doc = await getDocument(order.ticketPdfDocId);
    if (doc) return { fileName: doc.fileName, body: await readDocumentBody(doc) };
  }

  const [event, org, tickets] = await Promise.all([
    db.collection<Event>("events").findOne({ _id: toObjectId(order.eventId)! }),
    db.collection<Organization>("organizations").findOne({ _id: toObjectId(order.organizationId)! }, { projection: { name: 1 } }),
    db.collection<Ticket>("tickets").find({ orderId }).sort({ _id: 1 }).toArray(),
  ]);
  if (!event || tickets.length === 0) return null;
  const types = await db
    .collection<TicketType>("ticketTypes")
    .find({ _id: { $in: safeObjectIds([...new Set(tickets.map((t) => t.ticketTypeId))]) } }, { projection: { name: 1 } })
    .toArray();
  const typeName = new Map(types.map((t) => [t._id!.toString(), t.name]));

  const invoice = await issueCustomerInvoice(orderId, event.title);
  const body = Buffer.from(
    await buildTicketPdf({
      event: { title: event.title, venue: event.venue, startsAt: event.startsAt, timezone: event.timezone },
      organizationName: org?.name ?? "",
      orderRef: `Order ${orderId.slice(-8).toUpperCase()}`,
      tickets: tickets.map((t) => ({
        code: t.code,
        qrPayload: t.qrPayload,
        attendeeName: t.attendeeName,
        ticketTypeName: typeName.get(t.ticketTypeId) ?? "Ticket",
      })),
      invoice,
    }),
  );
  const fileName = `${slugForFile(event.title)}-tickets-${orderId.slice(-6)}.pdf`;
  const stored = await storeDocument({
    organizationId: order.organizationId,
    kind: "TICKET_PDF",
    fileName,
    contentType: "application/pdf",
    body,
    uploadedBy: null,
  });
  // First writer wins; a concurrent build's document is simply never referenced.
  await db
    .collection<Order>("orders")
    .updateOne({ _id, $or: [{ ticketPdfDocId: null }, { ticketPdfDocId: { $exists: false } }] }, { $set: { ticketPdfDocId: stored._id!.toString() } });
  return { fileName, body };
}
