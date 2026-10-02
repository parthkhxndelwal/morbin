import { ObjectId } from "mongodb";
import { audit } from "@/lib/audit";
import { getDb, toObjectId } from "@/lib/db";
import { formatINR } from "@/lib/format";
import { unsettledTotals } from "@/lib/ledger";
import { quoteRefund, requestRefund } from "@/lib/refunds";
import { TxAbort } from "@/lib/tx";
import type { EmailRecord, Event, Order, Organization, Ticket, TicketType, TicketTypeStatus } from "@/lib/types";

/**
 * Event and ticket-type rules. Every function takes the organisation id and
 * scopes its queries by it, and returns or throws `TxAbort` with a message an
 * organiser can act on. Pages and actions never re-implement these rules.
 */

export interface EventActor {
  organizationId: string;
  userId: string;
  /** "OWNER" for the organisation itself, "ADMIN" for Morbin support. */
  capacity: "OWNER" | "ADMIN";
}

async function loadEvent(organizationId: string, eventId: string): Promise<Event & { _id: ObjectId }> {
  const _id = toObjectId(eventId);
  if (!_id) throw new TxAbort("Event not found", 404);
  const db = await getDb();
  const event = await db.collection<Event>("events").findOne({ _id, organizationId });
  if (!event) throw new TxAbort("Event not found", 404);
  return event as Event & { _id: ObjectId };
}

async function loadOrg(organizationId: string): Promise<Organization> {
  const db = await getDb();
  const org = await db.collection<Organization>("organizations").findOne({ _id: toObjectId(organizationId)! });
  if (!org) throw new TxAbort("Organisation not found", 404);
  return org;
}

/** What stands between this event and being published. Empty = ready. */
export async function publishBlockers(organizationId: string, eventId: string): Promise<string[]> {
  const [event, org] = await Promise.all([loadEvent(organizationId, eventId), loadOrg(organizationId)]);
  const db = await getDb();
  const types = await db.collection<TicketType>("ticketTypes").find({ eventId }).toArray();
  const blockers: string[] = [];
  if (org.status === "SUSPENDED") blockers.push("Your organisation is suspended.");
  if (event.endsAt < new Date()) blockers.push("The event has already ended — update its dates first.");
  const sellable = types.filter((t) => (t.status ?? "ACTIVE") !== "HIDDEN");
  if (sellable.length === 0) blockers.push("Add at least one ticket type.");
  if (types.some((t) => t.pricePaise > 0) && org.paymentAccountStatus !== "VERIFIED") {
    blockers.push("Paid tickets need your organisation to be verified by Morbin.");
  }
  return blockers;
}

export async function setEventStatus(
  actor: EventActor,
  eventId: string,
  next: "PUBLISHED" | "DRAFT",
): Promise<void> {
  const event = await loadEvent(actor.organizationId, eventId);
  const db = await getDb();
  if (next === "PUBLISHED") {
    if (event.status !== "DRAFT") throw new TxAbort("Only a draft can be published.", 409);
    const blockers = await publishBlockers(actor.organizationId, eventId);
    if (blockers.length) throw new TxAbort(blockers[0]);
  } else {
    if (event.status !== "PUBLISHED") throw new TxAbort("Only a published event can be unpublished.", 409);
    const sold = await db
      .collection<Order>("orders")
      .countDocuments({ eventId, status: { $in: ["CREATED", "PAID", "PARTIALLY_REFUNDED"] } });
    if (sold > 0) {
      throw new TxAbort("People have already booked. Cancel the event instead, which refunds them.", 409);
    }
  }
  const r = await db
    .collection<Event>("events")
    .updateOne({ _id: event._id, status: event.status }, { $set: { status: next, updatedAt: new Date() } });
  if (r.modifiedCount === 0) throw new TxAbort("The event changed — reload and try again.", 409);
  await audit({
    actorId: actor.userId,
    actorRole: actor.capacity,
    action: next === "PUBLISHED" ? "event.published" : "event.unpublished",
    targetType: "event",
    targetId: eventId,
    organizationId: actor.organizationId,
    meta: { support: actor.capacity === "ADMIN" },
  });
}

export interface CancellationPreview {
  orders: number;
  tickets: number;
  refundPaise: number;
  costPaise: number;
  unsettledPaise: number;
  shortfallPaise: number;
}

/** Live (unrefunded) tickets per paid order of an event. */
async function liveTicketsByOrder(eventId: string): Promise<Map<string, string[]>> {
  const db = await getDb();
  const tickets = await db
    .collection<Ticket>("tickets")
    .find(
      { eventId, status: { $in: ["VALID", "USED"] }, refundCaseId: null },
      { projection: { orderId: 1 } },
    )
    .toArray();
  const byOrder = new Map<string, string[]>();
  for (const t of tickets) {
    const list = byOrder.get(t.orderId) ?? [];
    list.push(t._id!.toString());
    byOrder.set(t.orderId, list);
  }
  return byOrder;
}

/** What cancelling would refund, and whether the balance covers it. */
export async function previewCancellation(organizationId: string, eventId: string): Promise<CancellationPreview> {
  await loadEvent(organizationId, eventId);
  const byOrder = await liveTicketsByOrder(eventId);
  let refundPaise = 0;
  let costPaise = 0;
  let tickets = 0;
  for (const [orderId, ticketIds] of byOrder) {
    const q = await quoteRefund({ organizationId, orderId, ticketIds, speed: "NORMAL", settledBy: "MORBIN" });
    refundPaise += q.amountPaise;
    costPaise += q.cost.totalPaise;
    tickets += ticketIds.length;
  }
  const db = await getDb();
  const { totals } = await unsettledTotals(db, organizationId);
  return {
    orders: byOrder.size,
    tickets,
    refundPaise,
    costPaise,
    unsettledPaise: totals.netPaise,
    shortfallPaise: Math.max(0, refundPaise + costPaise - totals.netPaise),
  };
}

/**
 * Cancel an event: sales stop immediately, every buyer is emailed, and one
 * refund request per order is raised for Morbin to approve. Requests the
 * balance can't cover are reported back; the cancellation itself still stands.
 */
export async function cancelEvent(
  actor: EventActor,
  eventId: string,
  reason: string,
): Promise<{ requested: number; failed: { orderId: string; error: string }[] }> {
  const event = await loadEvent(actor.organizationId, eventId);
  if (event.status === "CANCELLED") throw new TxAbort("This event is already cancelled.", 409);
  const db = await getDb();
  await db
    .collection<Event>("events")
    .updateOne({ _id: event._id }, { $set: { status: "CANCELLED", cancelledAt: new Date(), updatedAt: new Date() } });

  const byOrder = await liveTicketsByOrder(eventId);
  let requested = 0;
  const failed: { orderId: string; error: string }[] = [];
  for (const [orderId, ticketIds] of byOrder) {
    try {
      await requestRefund({
        organizationId: actor.organizationId,
        orderId,
        ticketIds,
        speed: "NORMAL",
        settledBy: "MORBIN",
        reason: `Event cancelled: ${reason}`.slice(0, 500),
        requestedBy: actor.userId,
        fromCancellation: true,
      });
      requested++;
    } catch (error) {
      failed.push({ orderId, error: error instanceof Error ? error.message : "failed" });
    }
  }

  // Tell every buyer now, not when their refund lands.
  const orders = await db
    .collection<Order>("orders")
    .find({ eventId, status: { $in: ["PAID", "PARTIALLY_REFUNDED"] } }, { projection: { buyerEmail: 1, buyerName: 1 } })
    .toArray();
  for (const o of orders) {
    await db.collection<EmailRecord>("emailDeliveries").updateOne(
      { kind: "EVENT_UPDATE", orderId: o._id!.toString(), "meta.ticketCode": `cancelled:${eventId}` },
      {
        $setOnInsert: {
          orderId: o._id!.toString(),
          ticketId: null,
          recipient: o.buyerEmail,
          kind: "EVENT_UPDATE",
          status: "QUEUED",
          attempts: 0,
          lastError: null,
          meta: {
            eventTitle: event.title,
            attendeeName: o.buyerName,
            ticketCode: `cancelled:${eventId}`,
          },
        },
      },
      { upsert: true },
    );
  }

  await audit({
    actorId: actor.userId,
    actorRole: actor.capacity,
    action: "event.cancelled",
    targetType: "event",
    targetId: eventId,
    organizationId: actor.organizationId,
    meta: { refundRequests: requested, failed: failed.length, support: actor.capacity === "ADMIN" },
  });
  return { requested, failed };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Ticket types
 * ──────────────────────────────────────────────────────────────────────────── */

export interface TicketTypeInput {
  name: string;
  description: string;
  pricePaise: number;
  capacity: number;
  saleStartsAt: Date | null;
  saleEndsAt: Date | null;
  defaultMaxPerOrder: number | null;
}

function assertEditable(event: Event) {
  if (event.status === "CANCELLED") throw new TxAbort("This event is cancelled.");
  if (event.endsAt < new Date()) throw new TxAbort("This event has ended.");
}

export async function createTicketTypeFor(
  actor: EventActor,
  eventId: string,
  input: TicketTypeInput,
): Promise<string> {
  const event = await loadEvent(actor.organizationId, eventId);
  assertEditable(event);
  const db = await getDb();
  const count = await db.collection<TicketType>("ticketTypes").countDocuments({ eventId });
  const now = new Date();
  const { insertedId } = await db.collection<TicketType>("ticketTypes").insertOne({
    eventId,
    name: input.name,
    description: input.description,
    pricePaise: input.pricePaise,
    capacity: input.capacity,
    soldCount: 0,
    saleStartsAt: input.saleStartsAt,
    saleEndsAt: input.saleEndsAt,
    defaultMaxPerOrder: input.defaultMaxPerOrder,
    audienceOptionIds: null,
    status: "ACTIVE",
    sortOrder: count,
    createdAt: now,
    updatedAt: now,
  });
  await audit({
    actorId: actor.userId,
    actorRole: actor.capacity,
    action: "ticketType.created",
    targetType: "ticketType",
    targetId: insertedId.toString(),
    organizationId: actor.organizationId,
    meta: { eventId, pricePaise: input.pricePaise, capacity: input.capacity },
  });
  return insertedId.toString();
}

/**
 * Edit a ticket type. Once any are sold, the price is locked (buyers paid the
 * old price) and capacity can't drop below what's sold.
 */
export async function updateTicketTypeFor(
  actor: EventActor,
  eventId: string,
  ticketTypeId: string,
  input: TicketTypeInput,
): Promise<void> {
  const event = await loadEvent(actor.organizationId, eventId);
  assertEditable(event);
  const _id = toObjectId(ticketTypeId);
  const db = await getDb();
  const current = _id ? await db.collection<TicketType>("ticketTypes").findOne({ _id, eventId }) : null;
  if (!current) throw new TxAbort("Ticket type not found", 404);
  if (current.soldCount > 0 && input.pricePaise !== current.pricePaise) {
    throw new TxAbort("The price is locked because tickets have been sold. Add a new ticket type instead.");
  }
  // Conditional on soldCount so a sale landing mid-edit can't be oversold.
  const r = await db.collection<TicketType>("ticketTypes").updateOne(
    { _id: current._id, eventId, soldCount: { $lte: input.capacity } },
    {
      $set: {
        name: input.name,
        description: input.description,
        pricePaise: input.pricePaise,
        capacity: input.capacity,
        saleStartsAt: input.saleStartsAt,
        saleEndsAt: input.saleEndsAt,
        defaultMaxPerOrder: input.defaultMaxPerOrder,
        updatedAt: new Date(),
      },
    },
  );
  if (r.matchedCount === 0) {
    throw new TxAbort(`Capacity can't be lower than the ${current.soldCount} tickets already sold.`);
  }
  await audit({
    actorId: actor.userId,
    actorRole: actor.capacity,
    action: "ticketType.updated",
    targetType: "ticketType",
    targetId: ticketTypeId,
    organizationId: actor.organizationId,
    meta: { eventId, capacity: input.capacity },
  });
}

export async function setTicketTypeStatus(
  actor: EventActor,
  eventId: string,
  ticketTypeId: string,
  status: TicketTypeStatus,
): Promise<void> {
  await loadEvent(actor.organizationId, eventId);
  const _id = toObjectId(ticketTypeId);
  const db = await getDb();
  const r = _id
    ? await db
        .collection<TicketType>("ticketTypes")
        .updateOne({ _id, eventId }, { $set: { status, updatedAt: new Date() } })
    : null;
  if (!r?.matchedCount) throw new TxAbort("Ticket type not found", 404);
  await audit({
    actorId: actor.userId,
    actorRole: actor.capacity,
    action: "ticketType.status",
    targetType: "ticketType",
    targetId: ticketTypeId,
    organizationId: actor.organizationId,
    meta: { eventId, status },
  });
}

export async function deleteTicketType(actor: EventActor, eventId: string, ticketTypeId: string): Promise<void> {
  await loadEvent(actor.organizationId, eventId);
  const _id = toObjectId(ticketTypeId);
  const db = await getDb();
  if (!_id) throw new TxAbort("Ticket type not found", 404);
  const everSold = await db.collection<Order>("orders").countDocuments({ "items.ticketTypeId": ticketTypeId });
  if (everSold > 0) {
    throw new TxAbort("This ticket type has orders, so it can't be deleted. Hide it instead.", 409);
  }
  const r = await db.collection<TicketType>("ticketTypes").deleteOne({ _id, eventId, soldCount: 0 });
  if (r.deletedCount === 0) throw new TxAbort("This ticket type can't be deleted.", 409);
  await audit({
    actorId: actor.userId,
    actorRole: actor.capacity,
    action: "ticketType.deleted",
    targetType: "ticketType",
    targetId: ticketTypeId,
    organizationId: actor.organizationId,
    meta: { eventId },
  });
}

/** Human summary of a cancellation preview for confirmation dialogs. */
export function describeCancellation(p: CancellationPreview): string {
  if (p.orders === 0) return "Nobody has booked yet, so there is nothing to refund.";
  return `${p.tickets} ticket(s) across ${p.orders} order(s) will be put up for refund: ${formatINR(
    p.refundPaise,
  )} to customers plus ${formatINR(p.costPaise)} in refund costs.`;
}
