import type { TicketTypeRow } from "@/components/features/tickets/ticket-types-card";
import { getDb, safeObjectIds, toObjectId } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import type { Event, Order, Payout, PayoutMessage, PayoutTotals, Ticket, TicketType } from "@/lib/types";
import { toLocalDateTimeInput } from "@/lib/validations";

/**
 * Read models for dashboard pages.
 *
 * Every function here takes the organisation id and filters by it in the query
 * itself (never a post-check), and returns plain serialisable rows, so client
 * components never receive Mongo documents or fields they shouldn't see.
 */

export interface OrgEventRow {
  id: string;
  title: string;
  venue: string;
  slug: string;
  status: string;
  startsAt: string;
  endsAt: string;
  sold: number;
  capacity: number;
  grossPaise: number;
}

/** Ticket revenue of an order, excluding any convenience fee. */
/** An order's ticket value (never the buyer's convenience fee). */
export const ORDER_TICKET_VALUE = { $ifNull: ["$subtotalPaise", "$totalPaise"] };
/** Ticket value still kept after refunds — what an organiser actually sold. */
export const ORDER_NET_TICKET_VALUE = {
  $subtract: [ORDER_TICKET_VALUE, { $ifNull: ["$refundedPaise", 0] }],
};
/** Orders that count as sales, including ones partly refunded since. */
export const SOLD_ORDER_STATUSES = ["PAID", "PARTIALLY_REFUNDED"];

export async function getOrgEventRows(orgId: string): Promise<OrgEventRow[]> {
  const db = await getDb();
  const events = await db
    .collection<Event>("events")
    .find({ organizationId: orgId })
    .sort({ startsAt: -1 })
    .toArray();
  if (events.length === 0) return [];
  const ids = events.map((e) => e._id!.toString());

  const [types, sales] = await Promise.all([
    db
      .collection<TicketType>("ticketTypes")
      .aggregate<{ _id: string; sold: number; capacity: number }>([
        { $match: { eventId: { $in: ids } } },
        { $group: { _id: "$eventId", sold: { $sum: "$soldCount" }, capacity: { $sum: "$capacity" } } },
      ])
      .toArray(),
    db
      .collection<Order>("orders")
      .aggregate<{ _id: string; gross: number }>([
        { $match: { organizationId: orgId, eventId: { $in: ids }, status: "PAID" } },
        { $group: { _id: "$eventId", gross: { $sum: ORDER_TICKET_VALUE } } },
      ])
      .toArray(),
  ]);
  const typesBy = new Map(types.map((t) => [t._id, t]));
  const salesBy = new Map(sales.map((s) => [s._id, s.gross]));
  const now = new Date();

  return events.map((e) => {
    const id = e._id!.toString();
    const t = typesBy.get(id);
    return {
      id,
      title: e.title,
      venue: e.venue,
      slug: e.slug,
      status: e.status === "PUBLISHED" && e.endsAt < now ? "ENDED" : e.status,
      startsAt: e.startsAt.toISOString(),
      endsAt: e.endsAt.toISOString(),
      sold: t?.sold ?? 0,
      capacity: t?.capacity ?? 0,
      grossPaise: salesBy.get(id) ?? 0,
    };
  });
}

export interface OrgOverview {
  grossPaise: number;
  paidOrders: number;
  ticketsIssued: number;
  checkedIn: number;
  upcomingEvents: number;
  /** One point per day for the last 30 days (IST dates), oldest first. */
  dailySales: { date: string; grossPaise: number; tickets: number }[];
}

export async function getOrgOverview(orgId: string): Promise<OrgOverview> {
  const db = await getDb();
  const since = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000);
  since.setUTCHours(0, 0, 0, 0);
  const eventIds = (
    await db
      .collection<Event>("events")
      .find({ organizationId: orgId }, { projection: { _id: 1, status: 1, endsAt: 1 } })
      .toArray()
  ).map((e) => ({ id: e._id!.toString(), upcoming: e.status !== "CANCELLED" && e.endsAt >= new Date() }));
  const ids = eventIds.map((e) => e.id);

  const [totals, tickets, daily] = await Promise.all([
    db
      .collection<Order>("orders")
      .aggregate<{ gross: number; count: number }>([
        { $match: { organizationId: orgId, status: "PAID" } },
        { $group: { _id: null, gross: { $sum: ORDER_TICKET_VALUE }, count: { $sum: 1 } } },
      ])
      .toArray(),
    ids.length
      ? db
          .collection<Ticket>("tickets")
          .aggregate<{ _id: string; n: number }>([
            { $match: { eventId: { $in: ids }, status: { $in: ["VALID", "USED"] } } },
            { $group: { _id: "$status", n: { $sum: 1 } } },
          ])
          .toArray()
      : Promise.resolve([]),
    db
      .collection<Order>("orders")
      .aggregate<{ _id: string; gross: number; tickets: number }>([
        { $match: { organizationId: orgId, status: "PAID", paidAt: { $gte: since } } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$paidAt", timezone: "Asia/Kolkata" } },
            gross: { $sum: ORDER_TICKET_VALUE },
            tickets: { $sum: { $sum: "$items.quantity" } },
          },
        },
      ])
      .toArray(),
  ]);

  const byStatus = new Map(tickets.map((t) => [t._id, t.n]));
  const byDay = new Map(daily.map((d) => [d._id, d]));
  const dailySales: OrgOverview["dailySales"] = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date(since.getTime() + i * 24 * 60 * 60 * 1000);
    const key = new Date(d.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const row = byDay.get(key);
    dailySales.push({ date: key, grossPaise: row?.gross ?? 0, tickets: row?.tickets ?? 0 });
  }

  return {
    grossPaise: totals[0]?.gross ?? 0,
    paidOrders: totals[0]?.count ?? 0,
    ticketsIssued: (byStatus.get("VALID") ?? 0) + (byStatus.get("USED") ?? 0),
    checkedIn: byStatus.get("USED") ?? 0,
    upcomingEvents: eventIds.filter((e) => e.upcoming).length,
    dailySales,
  };
}

export interface OrderRow {
  id: string;
  eventId: string;
  eventTitle: string;
  buyerName: string;
  buyerEmail: string;
  tickets: number;
  amountPaise: number;
  status: string;
  createdAt: string;
  paidAt: string | null;
  audience: string | null;
}

export async function getOrgOrderRows(
  orgId: string,
  opts: { eventId?: string; limit?: number; statuses?: Order["status"][] } = {},
): Promise<OrderRow[]> {
  const db = await getDb();
  const filter: Record<string, unknown> = { organizationId: orgId };
  if (opts.eventId) filter.eventId = opts.eventId;
  if (opts.statuses) filter.status = { $in: opts.statuses };
  const orders = await db
    .collection<Order>("orders")
    .find(filter, {
      projection: {
        eventId: 1,
        buyerName: 1,
        buyerEmail: 1,
        items: 1,
        totalPaise: 1,
        status: 1,
        createdAt: 1,
        paidAt: 1,
        flowBranch: 1,
      },
    })
    .sort({ createdAt: -1 })
    .limit(opts.limit ?? 2000)
    .toArray();
  const eventIds = [...new Set(orders.map((o) => o.eventId))];
  const events = eventIds.length
    ? await db
        .collection<Event>("events")
        .find({ _id: { $in: safeObjectIds(eventIds) }, organizationId: orgId }, { projection: { title: 1 } })
        .toArray()
    : [];
  const titles = new Map(events.map((e) => [e._id!.toString(), e.title]));
  return orders.map((o) => ({
    id: o._id!.toString(),
    eventId: o.eventId,
    eventTitle: titles.get(o.eventId) ?? "—",
    buyerName: o.buyerName,
    buyerEmail: o.buyerEmail,
    tickets: o.items.reduce((s, i) => s + i.quantity, 0),
    amountPaise: o.totalPaise,
    status: o.status,
    createdAt: o.createdAt.toISOString(),
    paidAt: o.paidAt ? o.paidAt.toISOString() : null,
    audience: o.flowBranch ?? null,
  }));
}

export interface EventOverview {
  ticketSalesPaise: number;
  paidOrders: number;
  ticketsLive: number;
  checkedIn: number;
  capacity: number;
  hasBookings: boolean;
  ticketTypes: TicketTypeRow[];
}

/** KPIs and ticket types for one event. The caller has already scoped the event to the org. */
export async function getEventOverview(eventId: string, orgId: string): Promise<EventOverview> {
  const db = await getDb();
  const [types, orderAgg, ticketAgg, typesWithOrders, anyBooking] = await Promise.all([
    db.collection<TicketType>("ticketTypes").find({ eventId }).sort({ sortOrder: 1, pricePaise: 1 }).toArray(),
    db
      .collection<Order>("orders")
      .aggregate<{ gross: number; refunded: number; count: number }>([
        { $match: { organizationId: orgId, eventId, status: { $in: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] } } },
        {
          $group: {
            _id: null,
            gross: { $sum: ORDER_TICKET_VALUE },
            refunded: { $sum: { $ifNull: ["$refundedPaise", 0] } },
            count: { $sum: 1 },
          },
        },
      ])
      .toArray(),
    db
      .collection<Ticket>("tickets")
      .aggregate<{ _id: string; n: number }>([
        { $match: { eventId, status: { $in: ["VALID", "USED"] } } },
        { $group: { _id: "$status", n: { $sum: 1 } } },
      ])
      .toArray(),
    db.collection<Order>("orders").distinct("items.ticketTypeId", { eventId }),
    db.collection<Order>("orders").countDocuments({ eventId, status: { $in: ["CREATED", "PAID", "PARTIALLY_REFUNDED"] } }, { limit: 1 }),
  ]);
  const byStatus = new Map(ticketAgg.map((t) => [t._id, t.n]));
  const ordered = new Set(typesWithOrders as string[]);
  const window = (t: TicketType) => {
    if (t.saleStartsAt && t.saleStartsAt > new Date()) return `Sales open ${formatDateTime(t.saleStartsAt)}`;
    if (t.saleEndsAt) return `Sales close ${formatDateTime(t.saleEndsAt)}`;
    return null;
  };
  return {
    ticketSalesPaise: (orderAgg[0]?.gross ?? 0) - (orderAgg[0]?.refunded ?? 0),
    paidOrders: orderAgg[0]?.count ?? 0,
    ticketsLive: (byStatus.get("VALID") ?? 0) + (byStatus.get("USED") ?? 0),
    checkedIn: byStatus.get("USED") ?? 0,
    capacity: types.reduce((s, t) => s + t.capacity, 0),
    hasBookings: anyBooking > 0,
    ticketTypes: types.map((t) => ({
      id: t._id!.toString(),
      name: t.name,
      description: t.description,
      pricePaise: t.pricePaise,
      capacity: t.capacity,
      sold: t.soldCount,
      status: t.status ?? "ACTIVE",
      maxPerOrder: t.defaultMaxPerOrder ?? null,
      saleStartsAt: t.saleStartsAt ? toLocalDateTimeInput(t.saleStartsAt) : "",
      saleEndsAt: t.saleEndsAt ? toLocalDateTimeInput(t.saleEndsAt) : "",
      saleWindow: window(t),
      hasOrders: ordered.has(t._id!.toString()),
    })),
  };
}

export interface AttendeeRow {
  id: string;
  code: string;
  name: string;
  email: string;
  ticketType: string;
  status: string;
  checkedInAt: string | null;
  audience: string | null;
  orderId: string;
}

/** Tickets for one event (already scoped to the org by the caller). */
export async function getEventAttendeeRows(eventId: string): Promise<AttendeeRow[]> {
  const db = await getDb();
  const [tickets, types] = await Promise.all([
    db.collection<Ticket>("tickets").find({ eventId }).sort({ _id: -1 }).limit(20_000).toArray(),
    db.collection<TicketType>("ticketTypes").find({ eventId }, { projection: { name: 1 } }).toArray(),
  ]);
  const typeName = new Map(types.map((t) => [t._id!.toString(), t.name]));
  return tickets.map((t) => ({
    id: t._id!.toString(),
    code: t.code,
    name: t.attendeeName,
    email: t.attendeeEmail,
    ticketType: typeName.get(t.ticketTypeId) ?? "Ticket",
    status: t.refundCaseId && t.status !== "REFUNDED" ? "REFUND_PENDING" : t.status,
    checkedInAt: t.checkedInAt ? t.checkedInAt.toISOString() : null,
    audience: t.flowBranch ?? null,
    orderId: t.orderId,
  }));
}

export interface RefundRow {
  id: string;
  organizationId: string;
  organizationName: string | null;
  eventId: string;
  eventTitle: string;
  orderId: string;
  customerName: string;
  customerEmail: string;
  tickets: number;
  amountPaise: number;
  costPaise: number;
  settledBy: "MORBIN" | "ORGANISATION";
  speed: "NORMAL" | "INSTANT";
  status: string;
  reason: string;
  fromCancellation: boolean;
  decisionNote: string | null;
  failureReason: string | null;
  arn: string | null;
  manualReference: string | null;
  createdAt: string;
  decidedAt: string | null;
  completedAt: string | null;
  /** Admin → customer emails on this case (admin queue only; empty for owners). */
  messages: import("@/lib/refund-messages").RefundMessageView[];
}

/** Refund cases for one organisation, or (orgId null) for the admin queue. */
export async function getRefundRows(orgId: string | null): Promise<RefundRow[]> {
  const db = await getDb();
  const cases = await db
    .collection<import("@/lib/types").RefundCase>("refundCases")
    .find(orgId ? { organizationId: orgId } : {})
    .sort({ createdAt: -1 })
    .limit(5000)
    .toArray();
  const eventIds = [...new Set(cases.map((c) => c.eventId))];
  const orgIds = [...new Set(cases.map((c) => c.organizationId))];
  const [events, orgs] = await Promise.all([
    eventIds.length
      ? db.collection<Event>("events").find({ _id: { $in: safeObjectIds(eventIds) } }, { projection: { title: 1 } }).toArray()
      : [],
    !orgId && orgIds.length
      ? db.collection("organizations").find({ _id: { $in: safeObjectIds(orgIds) } }, { projection: { name: 1 } }).toArray()
      : [],
  ]);
  const titles = new Map(events.map((e) => [e._id!.toString(), e.title]));
  const orgNames = new Map(orgs.map((o) => [o._id.toString(), o.name as string]));
  // The customer correspondence is Morbin's; organisations don't see it.
  const threads = orgId
    ? new Map()
    : await (await import("@/lib/refund-messages")).refundThreads(cases.map((c) => c._id!.toString()));
  return cases.map((c) => ({
    messages: threads.get(c._id!.toString()) ?? [],
    id: c._id!.toString(),
    organizationId: c.organizationId,
    organizationName: orgNames.get(c.organizationId) ?? null,
    eventId: c.eventId,
    eventTitle: titles.get(c.eventId) ?? "—",
    orderId: c.orderId,
    customerName: c.customer.name,
    customerEmail: c.customer.email,
    tickets: c.ticketIds.length,
    amountPaise: c.amountPaise,
    costPaise: c.cost.totalPaise,
    settledBy: c.settledBy,
    speed: c.speed,
    status: c.status,
    reason: c.reason,
    fromCancellation: c.fromCancellation,
    decisionNote: c.decisionNote,
    failureReason: c.failureReason,
    arn: c.arn,
    manualReference: c.manualReference,
    createdAt: c.createdAt.toISOString(),
    decidedAt: c.decidedAt?.toISOString() ?? null,
    completedAt: c.completedAt?.toISOString() ?? null,
  }));
}

export interface PayoutRow {
  id: string;
  organizationId: string;
  organizationName: string | null;
  status: string;
  netPaise: number;
  entryCount: number;
  cutoffAt: string;
  bankReference: string | null;
  transferredAt: string | null;
  createdAt: string;
}

export async function getPayoutRows(orgId: string | null): Promise<PayoutRow[]> {
  const db = await getDb();
  const payouts = await db
    .collection<Payout>("payouts")
    // Owners never see drafts (work in progress on Morbin's side) or cancelled payouts.
    .find(orgId ? { organizationId: orgId, status: { $nin: ["CANCELLED", "DRAFT"] } } : {})
    .sort({ createdAt: -1 })
    .limit(2000)
    .toArray();
  const orgNames = new Map<string, string>();
  if (!orgId && payouts.length) {
    const orgs = await db
      .collection("organizations")
      .find({ _id: { $in: safeObjectIds([...new Set(payouts.map((p) => p.organizationId))]) } }, { projection: { name: 1 } })
      .toArray();
    for (const o of orgs) orgNames.set(o._id.toString(), o.name as string);
  }
  return payouts.map((p) => ({
    id: p._id!.toString(),
    organizationId: p.organizationId,
    organizationName: orgNames.get(p.organizationId) ?? null,
    status: p.status,
    netPaise: p.totals.netPaise,
    entryCount: p.entryCount,
    cutoffAt: p.cutoffAt.toISOString(),
    bankReference: p.bankReference,
    transferredAt: p.transferredAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
  }));
}

export interface PayoutDetail extends PayoutRow {
  totals: PayoutTotals;
  note: string | null;
  statementDocId: string | null;
  breakdownDocId: string | null;
  acknowledgedAt: string | null;
  messages: { id: string; authorRole: "OWNER" | "ADMIN"; message: string; createdAt: string }[];
}

/** One payout; `orgId` null = admin (any organisation). */
export async function getPayoutDetail(id: string, orgId: string | null): Promise<PayoutDetail | null> {
  const _id = toObjectId(id);
  if (!_id) return null;
  const db = await getDb();
  const p = await db
    .collection<Payout>("payouts")
    .findOne(orgId ? { _id, organizationId: orgId, status: { $nin: ["CANCELLED", "DRAFT"] } } : { _id });
  if (!p) return null;
  const [messages, org] = await Promise.all([
    db
      .collection<PayoutMessage>("payoutMessages")
      .find({ payoutId: id })
      .sort({ createdAt: 1 })
      .toArray(),
    db.collection("organizations").findOne({ _id: toObjectId(p.organizationId)! }, { projection: { name: 1 } }),
  ]);
  return {
    id,
    organizationId: p.organizationId,
    organizationName: (org?.name as string) ?? null,
    status: p.status,
    netPaise: p.totals.netPaise,
    entryCount: p.entryCount,
    cutoffAt: p.cutoffAt.toISOString(),
    bankReference: p.bankReference,
    transferredAt: p.transferredAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
    totals: p.totals,
    note: p.note,
    statementDocId: p.statementDocId,
    breakdownDocId: p.breakdownDocId,
    acknowledgedAt: p.acknowledgedAt?.toISOString() ?? null,
    messages: messages.map((m) => ({
      id: m._id!.toString(),
      authorRole: m.authorRole,
      message: m.message,
      createdAt: m.createdAt.toISOString(),
    })),
  };
}
