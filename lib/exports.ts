import { audit } from "@/lib/audit";
import { getDb, safeObjectIds, toObjectId } from "@/lib/db";
import { toCsv } from "@/lib/documents";
import type { Event, Order, Ticket, TicketType } from "@/lib/types";

/**
 * Server-side CSV exports of an organisation's data.
 *
 * Filters mirror the on-screen table, so "Export" downloads exactly what the
 * person is looking at. Every export is audit-logged with its filters and row
 * count (DPDP accountability). Cells are formula-escaped by `toCsv`.
 */

export interface ExportFilters {
  eventId?: string | null;
  status?: string | null;
  eventTitle?: string | null;
  q?: string | null;
}

function rupees(paise: number | undefined | null): string {
  return ((paise ?? 0) / 100).toFixed(2);
}

function matches(q: string | null | undefined, ...fields: (string | null | undefined)[]): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return fields.some((f) => f?.toLowerCase().includes(needle));
}

async function eventTitles(orgId: string, ids: string[]): Promise<Map<string, string>> {
  const db = await getDb();
  const events = ids.length
    ? await db
        .collection<Event>("events")
        .find({ _id: { $in: safeObjectIds(ids) }, organizationId: orgId }, { projection: { title: 1 } })
        .toArray()
    : [];
  return new Map(events.map((e) => [e._id!.toString(), e.title]));
}

export async function exportOrdersCsv(
  orgId: string,
  filters: ExportFilters,
  actor: { userId: string; role: "OWNER" | "ADMIN" },
): Promise<{ csv: string; rows: number }> {
  const db = await getDb();
  const query: Record<string, unknown> = { organizationId: orgId };
  if (filters.eventId && toObjectId(filters.eventId)) query.eventId = filters.eventId;
  if (filters.status) query.status = filters.status;
  const orders = await db.collection<Order>("orders").find(query).sort({ createdAt: -1 }).toArray();
  const titles = await eventTitles(orgId, [...new Set(orders.map((o) => o.eventId))]);
  const filtered = orders.filter(
    (o) =>
      (!filters.eventTitle || titles.get(o.eventId) === filters.eventTitle) &&
      matches(filters.q, o.buyerName, o.buyerEmail),
  );

  // Booking-flow answers become their own columns, in first-seen order.
  const answerLabels: string[] = [];
  for (const o of filtered) {
    for (const f of o.customFields ?? []) if (!answerLabels.includes(f.label)) answerLabels.push(f.label);
  }
  const header = [
    "Order ID",
    "Placed (UTC)",
    "Paid (UTC)",
    "Event",
    "Status",
    "Buyer name",
    "Buyer email",
    "Tickets",
    "Ticket value (INR)",
    "Convenience fee (INR)",
    "Fee paid by",
    "Buyer paid (INR)",
    "Your share (INR)",
    "Refunded (INR)",
    "Audience",
    "Verified via",
    "UTM source",
    "UTM campaign",
    ...answerLabels,
  ];
  const rows = filtered.map((o) => {
    const p = o.pricing;
    const answers = new Map((o.customFields ?? []).map((f) => [f.label, f.value]));
    return [
      o._id!.toString(),
      o.createdAt.toISOString(),
      o.paidAt?.toISOString() ?? "",
      titles.get(o.eventId) ?? "",
      o.status,
      o.buyerName,
      o.buyerEmail,
      o.items.reduce((s, i) => s + i.quantity, 0),
      rupees(p?.ticketTotalPaise ?? o.subtotalPaise),
      rupees(p?.feePaise ?? o.platformFeePaise),
      p?.bearer === "CUSTOMER" ? "Buyer" : "Organisation",
      rupees(p?.orderTotalPaise ?? o.totalPaise),
      rupees(p?.organiserNetPaise ?? o.organizerAmountPaise),
      rupees(o.refundedPaise),
      o.flowBranch ?? "",
      o.identityMethod ?? "",
      o.utm?.source ?? "",
      o.utm?.campaign ?? "",
      ...answerLabels.map((l) => answers.get(l) ?? ""),
    ];
  });
  await audit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: "export.orders",
    targetType: "organization",
    targetId: orgId,
    organizationId: orgId,
    meta: { filters, rows: rows.length },
  });
  return { csv: toCsv(header, rows), rows: rows.length };
}

export async function exportAttendeesCsv(
  orgId: string,
  filters: ExportFilters,
  actor: { userId: string; role: "OWNER" | "ADMIN" },
): Promise<{ csv: string; rows: number }> {
  const db = await getDb();
  const eventIds = filters.eventId
    ? [filters.eventId]
    : (await db.collection<Event>("events").find({ organizationId: orgId }, { projection: { _id: 1 } }).toArray()).map(
        (e) => e._id!.toString(),
      );
  const query: Record<string, unknown> = { eventId: { $in: eventIds } };
  // "Refund pending" is shown as a status but stored as an open refund case.
  if (filters.status === "REFUND_PENDING") Object.assign(query, { refundCaseId: { $ne: null }, status: { $ne: "REFUNDED" } });
  else if (filters.status) query.status = filters.status;
  const [tickets, types, titles] = await Promise.all([
    db.collection<Ticket>("tickets").find(query).sort({ _id: 1 }).toArray(),
    db.collection<TicketType>("ticketTypes").find({ eventId: { $in: eventIds } }, { projection: { name: 1 } }).toArray(),
    eventTitles(orgId, eventIds),
  ]);
  const typeName = new Map(types.map((t) => [t._id!.toString(), t.name]));
  const filtered = tickets.filter((t) => matches(filters.q, t.attendeeName, t.attendeeEmail, t.code));
  const header = [
    "Ticket code",
    "Event",
    "Ticket type",
    "Attendee name",
    "Attendee email",
    "Status",
    "Checked in (UTC)",
    "Audience",
    "Order ID",
  ];
  const rows = filtered.map((t) => [
    t.code,
    titles.get(t.eventId) ?? "",
    typeName.get(t.ticketTypeId) ?? "",
    t.attendeeName,
    t.attendeeEmail,
    t.status,
    t.checkedInAt?.toISOString() ?? "",
    t.flowBranch ?? "",
    t.orderId,
  ]);
  await audit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: "export.attendees",
    targetType: "organization",
    targetId: orgId,
    organizationId: orgId,
    meta: { filters, rows: rows.length },
  });
  return { csv: toCsv(header, rows), rows: rows.length };
}
