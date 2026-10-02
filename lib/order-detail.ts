import { getDb, toObjectId } from "@/lib/db";
import type { Event, Order, RefundCase, Ticket, TicketType } from "@/lib/types";

/** Everything the order panel shows, as a plain view model. */
export interface OrderDetail {
  id: string;
  shortId: string;
  eventId: string;
  eventTitle: string;
  status: string;
  buyerName: string;
  buyerEmail: string;
  createdAt: string;
  paidAt: string | null;
  identityMethod: string | null;
  audience: string | null;
  utm: { source: string | null; medium: string | null; campaign: string | null } | null;
  pricing: {
    ticketTotalPaise: number;
    feePaise: number;
    feeBearer: "CUSTOMER" | "ORGANISER";
    orderTotalPaise: number;
    organiserNetPaise: number;
    refundedPaise: number;
  };
  answers: { label: string; value: string }[];
  tickets: {
    id: string;
    code: string;
    typeName: string;
    attendeeName: string;
    attendeeEmail: string;
    status: string;
    checkedInAt: string | null;
    valuePaise: number;
    refundCaseId: string | null;
  }[];
  refunds: {
    id: string;
    status: string;
    amountPaise: number;
    tickets: number;
    settledBy: string;
    createdAt: string;
  }[];
  hasPayment: boolean;
}

/** Load an order only if it belongs to `organizationId`. */
export async function getOrderDetail(orderId: string, organizationId: string): Promise<OrderDetail | null> {
  const _id = toObjectId(orderId);
  if (!_id) return null;
  const db = await getDb();
  const order = await db.collection<Order>("orders").findOne({ _id, organizationId });
  if (!order) return null;
  const id = order._id!.toString();
  const [event, tickets, types, refunds] = await Promise.all([
    db.collection<Event>("events").findOne({ _id: toObjectId(order.eventId)!, organizationId }, { projection: { title: 1 } }),
    db.collection<Ticket>("tickets").find({ orderId: id }).sort({ _id: 1 }).toArray(),
    db
      .collection<TicketType>("ticketTypes")
      .find({ eventId: order.eventId }, { projection: { name: 1 } })
      .toArray(),
    db.collection<RefundCase>("refundCases").find({ orderId: id, organizationId }).sort({ createdAt: -1 }).toArray(),
  ]);
  const typeName = new Map(types.map((t) => [t._id!.toString(), t.name]));
  const itemPrice = new Map(order.items.map((i) => [i.ticketTypeId, i.unitPricePaise]));
  const p = order.pricing;
  return {
    id,
    shortId: id.slice(-8).toUpperCase(),
    eventId: order.eventId,
    eventTitle: event?.title ?? "—",
    status: order.status,
    buyerName: order.buyerName,
    buyerEmail: order.buyerEmail,
    createdAt: order.createdAt.toISOString(),
    paidAt: order.paidAt ? order.paidAt.toISOString() : null,
    identityMethod: order.identityMethod ?? null,
    audience: order.flowBranch ?? null,
    utm: order.utm ?? null,
    pricing: {
      ticketTotalPaise: p?.ticketTotalPaise ?? order.subtotalPaise,
      feePaise: p?.feePaise ?? order.platformFeePaise,
      feeBearer: p?.bearer ?? "ORGANISER",
      orderTotalPaise: p?.orderTotalPaise ?? order.totalPaise,
      organiserNetPaise: p?.organiserNetPaise ?? order.organizerAmountPaise,
      refundedPaise: order.refundedPaise ?? 0,
    },
    answers: (order.customFields ?? []).map((f) => ({ label: f.label, value: f.value })),
    tickets: tickets.map((t) => ({
      id: t._id!.toString(),
      code: t.code,
      typeName: typeName.get(t.ticketTypeId) ?? "Ticket",
      attendeeName: t.attendeeName,
      attendeeEmail: t.attendeeEmail,
      status: t.status,
      checkedInAt: t.checkedInAt ? t.checkedInAt.toISOString() : null,
      valuePaise: t.unitPricePaise ?? itemPrice.get(t.ticketTypeId) ?? 0,
      refundCaseId: t.refundCaseId ?? null,
    })),
    refunds: refunds.map((r) => ({
      id: r._id!.toString(),
      status: r.status,
      amountPaise: r.amountPaise,
      tickets: r.ticketIds.length,
      settledBy: r.settledBy,
      createdAt: r.createdAt.toISOString(),
    })),
    hasPayment: !!order.razorpayPaymentId,
  };
}
