import type { ClientSession, Db } from "mongodb";
import { getDb } from "@/lib/db";
import { makeTicketCode, signTicket } from "@/lib/tickets";
import type { EmailRecord, Event, Order, Ticket } from "@/lib/types";

/**
 * Build ticket documents for a paid order (one per seat). Attendees fall back
 * to the buyer's details. Pure apart from random codes; the caller inserts.
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
        attendeeEmail: attendee.email.toLowerCase(),
        code,
        qrPayload: signTicket(code),
        status: "VALID",
        checkedInAt: null,
        unitPricePaise: item.unitPricePaise,
        refundCaseId: null,
        // Denormalised: the per-audience cap counts against these.
        flowBranch: order.flowBranch ?? null,
        lookupKey: order.lookupKeys?.[0]?.key ?? null,
        flowVersion: order.flowVersion ?? null,
      });
    }
  }
  return tickets;
}

/**
 * Insert an order's tickets inside the caller's transaction, unless the order
 * already has some (a retried capture). Returns the order's tickets.
 */
export async function insertTicketsOnce(
  db: Db,
  session: ClientSession,
  order: Order,
): Promise<Ticket[]> {
  const orderId = order._id!.toString();
  const existing = await db.collection<Ticket>("tickets").find({ orderId }, { session }).toArray();
  if (existing.length > 0) return existing;
  const tickets = buildTickets(order);
  if (tickets.length === 0) return [];
  const inserted = await db.collection<Ticket>("tickets").insertMany(tickets, { session });
  return tickets.map((t, i) => ({ ...t, _id: inserted.insertedIds[i] }));
}

/**
 * Queue one ticket email per ticket. Runs after the capture transaction has
 * committed, so an email is never sent for a payment that rolled back. Keyed by
 * ticket id, so a retried capture can't queue duplicates.
 */
/**
 * Queue the ticket email for a paid order: one email to the buyer with every
 * ticket (and the fee invoice, when one is due) in a single PDF. The PDF is
 * built when the email is sent, so payment capture never waits on it or fails
 * because of it. Idempotent per order.
 */
export async function queueTicketEmails(order: Order, event: Event | null, tickets: Ticket[]): Promise<void> {
  if (tickets.length === 0) return;
  const db = await getDb();
  const orderId = order._id!.toString();
  const doc: EmailRecord = {
    orderId,
    ticketId: null,
    recipient: order.buyerEmail,
    kind: "TICKET_PDF",
    status: "QUEUED",
    attempts: 0,
    lastError: null,
    meta: {
      eventTitle: event?.title ?? "Your event",
      eventVenue: event?.venue ?? "",
      eventStartsAt: event?.startsAt?.toISOString() ?? "",
      attendeeName: order.buyerName,
      ticketCode: String(tickets.length),
      link: event?.slug ? `/event/${event.slug}/tickets` : null,
    },
  };
  await db
    .collection<EmailRecord>("emailDeliveries")
    .updateOne({ kind: "TICKET_PDF", orderId }, { $setOnInsert: doc }, { upsert: true });
}
