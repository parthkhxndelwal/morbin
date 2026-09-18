import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { verifyTicketPayload } from "@/lib/tickets";
import type { Event, Ticket } from "@/lib/types";

const schema = z.object({ input: z.string().min(1).max(200) });

/** Door check-in: resolve code or QR payload, verify ownership, burn once. */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const raw = parsed.data.input.trim().toUpperCase();
  const code = raw.includes(".")
    ? verifyTicketPayload(raw.toLowerCase())
    : raw;
  if (!code) return NextResponse.json({ error: "Invalid ticket" }, { status: 404 });

  const db = await getDb();
  const ticket = await db.collection<Ticket>("tickets").findOne({ code });
  if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });

  // Caller must belong to the event's org.
  const { ObjectId } = await import("mongodb");
  let event: Event | null = null;
  try {
    event = await db.collection<Event>("events").findOne({ _id: new ObjectId(ticket.eventId) });
  } catch {
    event = null;
  }
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });
  const member = await db.collection("memberships").findOne({
    organizationId: event.organizationId,
    userId: session.user.id,
  });
  if (!member) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (ticket.status === "USED")
    return NextResponse.json(
      { ok: false, error: "Already checked in", checkedInAt: ticket.checkedInAt },
      { status: 409 },
    );
  if (ticket.status !== "VALID")
    return NextResponse.json({ error: `Ticket is ${ticket.status}` }, { status: 400 });

  await db
    .collection("tickets")
    .updateOne({ _id: ticket._id }, { $set: { status: "USED", checkedInAt: new Date() } });
  return NextResponse.json({
    ok: true,
    attendeeName: ticket.attendeeName,
    eventTitle: event.title,
  });
}
