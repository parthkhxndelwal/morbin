import { getDb } from "@/lib/db";
import { makeTicketCode, signTicket, ticketQrSvg } from "@/lib/tickets";
import type { EmailRecord, Event, Order, Ticket } from "@/lib/types";

/**
 * Build ticket documents for a paid/free order (idempotent caller must check
 * for existing tickets first). Attendees fall back to buyer details.
 */
export function buildTickets(order: Order): Ticket[] {
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
  return tickets;
}

/** Insert tickets + queue TICKET emails. Returns inserted ticket count. */
export async function fulfillOrderTickets(
  order: Order,
  eventDoc: Event | null,
): Promise<number> {
  const db = await getDb();
  // Idempotency: never double-fulfill an order.
  const existing = await db
    .collection("tickets")
    .countDocuments({ orderId: order._id!.toString() });
  if (existing > 0) return existing;

  const tickets = buildTickets(order);
  if (tickets.length === 0) return 0;
  const inserted = await db.collection<Ticket>("tickets").insertMany(tickets);
  const ids = Object.values(inserted.insertedIds);
  const qrCache = new Map<string, string | null>();
  const emailDocs: EmailRecord[] = [];
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
  return tickets.length;
}
