import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb, safeObjectIds } from "@/lib/db";
import type { Event, Ticket } from "@/lib/types";

/**
 * The signed-in buyer's tickets.
 *
 * Scoped to the session, never to a supplied address. The previous version
 * accepted any `?email=` and returned that person's codes to anyone who guessed
 * it — an email-enumeration oracle that hands out live admission to an event.
 * Every buyer now holds a real session by the time they have a ticket (Google, or
 * the magic link), so the address is known and the parameter is unnecessary.
 */
export async function GET() {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) {
    return NextResponse.json(
      { error: "Sign in with the email you booked with to see your tickets." },
      { status: 401 },
    );
  }

  const db = await getDb();
  const tickets = await db
    .collection<Ticket>("tickets")
    .find({ attendeeEmail: email, status: { $in: ["VALID", "USED"] } })
    .sort({ _id: -1 })
    .limit(50)
    .toArray();

  const oids = safeObjectIds([...new Set(tickets.map((t) => t.eventId))]);
  const events = await db.collection<Event>("events").find({ _id: { $in: oids } }).toArray();
  const byId = new Map(events.map((e) => [e._id!.toString(), e]));

  return NextResponse.json({
    tickets: tickets.map((t) => {
      const event = byId.get(t.eventId);
      return {
        code: t.code,
        // The signed payload, so the buyer can show a scannable code without the
        // email being open on another device.
        qrPayload: t.qrPayload,
        attendeeName: t.attendeeName,
        status: t.status,
        eventTitle: event?.title ?? "Event",
        venue: event?.venue ?? "",
        startsAt: event?.startsAt?.toISOString() ?? null,
      };
    }),
  });
}
