import { getDb } from "@/lib/db";
import type { Event, Order, Ticket, TicketType } from "@/lib/types";

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
const ORDER_TICKET_VALUE = { $ifNull: ["$subtotalPaise", "$totalPaise"] };

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
  const { safeObjectIds } = await import("@/lib/db");
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
