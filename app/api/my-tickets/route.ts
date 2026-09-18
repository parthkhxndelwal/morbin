import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import type { Event, Ticket } from "@/lib/types";

const schema = z.object({ email: z.string().email() });

/** Buyer ticket lookup (no login): paid tickets for an email address. */
export async function GET(request: Request) {
  const email = new URL(request.url).searchParams.get("email") ?? "";
  const parsed = schema.safeParse({ email: email.toLowerCase() });
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  const db = await getDb();
  const tickets = await db
    .collection<Ticket>("tickets")
    .find({ attendeeEmail: parsed.data.email, status: { $in: ["VALID", "USED"] } })
    .sort({ _id: -1 })
    .limit(50)
    .toArray();
  const eventIds = [...new Set(tickets.map((t) => t.eventId))];
  const oids = eventIds
    .map((id) => {
      try {
        return new ObjectId(id);
      } catch {
        return null;
      }
    })
    .filter((o): o is ObjectId => o !== null);
  const events = await db
    .collection<Event>("events")
    .find({ _id: { $in: oids } })
    .toArray();
  const byId = new Map(events.map((e) => [e._id!.toString(), e]));
  return NextResponse.json({
    tickets: tickets.map((t) => ({
      code: t.code,
      attendeeName: t.attendeeName,
      status: t.status,
      eventTitle: byId.get(t.eventId)?.title ?? "Event",
      venue: byId.get(t.eventId)?.venue ?? "",
      startsAt: byId.get(t.eventId)?.startsAt ?? null,
    })),
  });
}
