import { getDb, toObjectId } from "@/lib/db";
import { normaliseTicketCode, verifyTicketPayload } from "@/lib/tickets";
import type { Event, Ticket } from "@/lib/types";

export type CheckInResult =
  | { ok: true; attendeeName: string; ticketType: string | null; eventTitle: string; code: string }
  | {
      ok: false;
      reason: "invalid" | "not_found" | "wrong_event" | "already_used" | "refunded" | "refund_pending";
      message: string;
      attendeeName?: string;
      checkedInAt?: string | null;
    };

/**
 * Check a ticket in, once. Accepts a bare code or a signed QR payload, only for
 * events of `organizationId` (and, when given, only for `eventId`, so a door
 * scanning for one event can't admit a ticket for another). The VALID → USED
 * update is conditional, so two scanners can't both admit the same ticket.
 */
export async function checkInTicket(input: {
  organizationId: string;
  scan: string;
  eventId?: string | null;
}): Promise<CheckInResult> {
  const raw = input.scan.trim();
  const code = raw.includes(".") ? verifyTicketPayload(raw) : normaliseTicketCode(raw);
  if (!code) return { ok: false, reason: "invalid", message: "This QR code isn't a valid Morbin ticket." };

  const db = await getDb();
  const ticket = await db.collection<Ticket>("tickets").findOne({ code });
  if (!ticket) return { ok: false, reason: "not_found", message: "No ticket with that code." };
  const event = await db
    .collection<Event>("events")
    .findOne({ _id: toObjectId(ticket.eventId)!, organizationId: input.organizationId }, { projection: { title: 1 } });
  // Another organisation's ticket reads as not found — no information leaks.
  if (!event) return { ok: false, reason: "not_found", message: "No ticket with that code." };
  if (input.eventId && ticket.eventId !== input.eventId) {
    return {
      ok: false,
      reason: "wrong_event",
      message: `This ticket is for "${event.title}", not this event.`,
      attendeeName: ticket.attendeeName,
    };
  }
  if (ticket.status === "REFUNDED") {
    return { ok: false, reason: "refunded", message: "This ticket was refunded and is no longer valid.", attendeeName: ticket.attendeeName };
  }
  if (ticket.refundCaseId) {
    return {
      ok: false,
      reason: "refund_pending",
      message: "A refund is pending for this ticket. Check with the organiser before admitting.",
      attendeeName: ticket.attendeeName,
    };
  }

  const burned = await db
    .collection<Ticket>("tickets")
    .findOneAndUpdate(
      { _id: ticket._id, status: "VALID", refundCaseId: null },
      { $set: { status: "USED", checkedInAt: new Date() } },
      { returnDocument: "after" },
    );
  if (!burned) {
    const current = await db.collection<Ticket>("tickets").findOne({ _id: ticket._id });
    return {
      ok: false,
      reason: "already_used",
      message: "Already checked in.",
      attendeeName: ticket.attendeeName,
      checkedInAt: current?.checkedInAt?.toISOString() ?? null,
    };
  }
  const type = await db
    .collection("ticketTypes")
    .findOne({ _id: toObjectId(ticket.ticketTypeId)! }, { projection: { name: 1 } });
  return {
    ok: true,
    attendeeName: ticket.attendeeName,
    ticketType: (type?.name as string) ?? null,
    eventTitle: event.title,
    code: ticket.code,
  };
}
