import "server-only";

import { getDb, safeObjectIds } from "@/lib/db";
import { ticketQrSvg } from "@/lib/tickets";
import type { Event, Order, Ticket } from "@/lib/types";

/**
 * A signed-in buyer's tickets, grouped by order. Scoped to the session's
 * email — never to anything a URL supplies.
 */

export interface BuyerTicketView {
  id: string;
  code: string;
  attendeeName: string;
  ticketTypeName: string;
  /** VALID | USED | REFUND_PENDING | REFUNDED (StatusBadge kind "ticket"). */
  status: "VALID" | "USED" | "REFUND_PENDING" | "REFUNDED";
  /** Server-rendered SVG of the signed payload; only for tickets that still admit. */
  qrSvg: string | null;
}

export interface BuyerOrderView {
  id: string;
  /** The PDF route serves only the buyer who placed a paid order. */
  canDownload: boolean;
  createdAt: string;
  event: { title: string; slug: string; venue: string; startsAt: string; timezone: string };
  tickets: BuyerTicketView[];
}

export async function getBuyerOrders(email: string): Promise<BuyerOrderView[]> {
  const db = await getDb();
  const tickets = await db
    .collection<Ticket>("tickets")
    .find({ attendeeEmail: email.toLowerCase(), status: { $in: ["VALID", "USED", "REFUNDED"] } })
    .sort({ _id: -1 })
    .limit(200)
    .toArray();
  if (tickets.length === 0) return [];
  const orderIds = [...new Set(tickets.map((t) => t.orderId))];
  const [orders, events] = await Promise.all([
    db
      .collection<Order>("orders")
      .find({ _id: { $in: safeObjectIds(orderIds) } }, { projection: { buyerEmail: 1, status: 1, createdAt: 1, items: 1 } })
      .toArray(),
    db
      .collection<Event>("events")
      .find({ _id: { $in: safeObjectIds([...new Set(tickets.map((t) => t.eventId))]) } })
      .toArray(),
  ]);
  const orderBy = new Map(orders.map((o) => [o._id!.toString(), o]));
  const eventBy = new Map(events.map((e) => [e._id!.toString(), e]));

  const groups = new Map<string, BuyerOrderView>();
  for (const t of tickets) {
    const order = orderBy.get(t.orderId);
    const event = eventBy.get(t.eventId);
    if (!event) continue;
    let group = groups.get(t.orderId);
    if (!group) {
      group = {
        id: t.orderId,
        canDownload:
          !!order && order.buyerEmail.toLowerCase() === email.toLowerCase() && ["PAID", "PARTIALLY_REFUNDED"].includes(order.status),
        createdAt: (order?.createdAt ?? new Date(0)).toISOString(),
        event: {
          title: event.title,
          slug: event.slug,
          venue: event.venue,
          startsAt: event.startsAt.toISOString(),
          timezone: event.timezone ?? "Asia/Kolkata",
        },
        tickets: [],
      };
      groups.set(t.orderId, group);
    }
    const status: BuyerTicketView["status"] =
      t.status === "REFUNDED" ? "REFUNDED" : t.refundCaseId ? "REFUND_PENDING" : t.status === "USED" ? "USED" : "VALID";
    group.tickets.push({
      id: t._id!.toString(),
      code: t.code,
      attendeeName: t.attendeeName,
      ticketTypeName: order?.items.find((i) => i.ticketTypeId === t.ticketTypeId)?.name ?? "Ticket",
      status,
      qrSvg: status === "VALID" ? await ticketQrSvg(t.qrPayload) : null,
    });
  }
  return [...groups.values()].sort((a, b) => b.event.startsAt.localeCompare(a.event.startsAt));
}
