import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { slugify } from "@/lib/slug";
import type { Event, EventStatus, TicketType } from "@/lib/types";

function oid(id: string): ObjectId | null {
  try {
    return new ObjectId(id);
  } catch {
    return null;
  }
}

export async function getOrgEvents(organizationId: string): Promise<Event[]> {
  const db = await getDb();
  return db
    .collection<Event>("events")
    .find({ organizationId })
    .sort({ createdAt: -1 })
    .toArray();
}

export async function getEventById(id: string): Promise<Event | null> {
  const _id = oid(id);
  if (!_id) return null;
  const db = await getDb();
  return db.collection<Event>("events").findOne({ _id });
}

export async function getPublishedEventBySlug(slug: string): Promise<{
  event: Event;
  ticketTypes: TicketType[];
} | null> {
  const db = await getDb();
  const event = await db.collection<Event>("events").findOne({ slug, status: "PUBLISHED" });
  if (!event || !event._id) return null;
  const now = new Date();
  if (event.endsAt < now) return null;
  const ticketTypes = await db
    .collection<TicketType>("ticketTypes")
    .find({ eventId: event._id.toString() })
    .toArray();
  return { event, ticketTypes };
}

export async function createEvent(
  organizationId: string,
  input: {
    title: string;
    description: string;
    venue: string;
    timezone: string;
    startsAt: Date;
    endsAt: Date;
  },
): Promise<Event> {
  const db = await getDb();
  const base = slugify(input.title) || "event";
  let slug = base;
  for (let i = 0; i < 5; i++) {
    const taken = await db.collection("events").findOne({ organizationId, slug });
    if (!taken) break;
    slug = `${base}-${Math.random().toString(36).slice(2, 7)}`;
  }
  const now = new Date();
  const event: Event = {
    organizationId,
    title: input.title.trim(),
    slug,
    description: input.description.trim(),
    venue: input.venue.trim(),
    timezone: input.timezone,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    status: "DRAFT",
    createdAt: now,
    updatedAt: now,
  };
  const { insertedId } = await db.collection<Event>("events").insertOne(event);
  return { ...event, _id: insertedId };
}

export async function updateEvent(
  id: string,
  organizationId: string,
  patch: Partial<Pick<Event, "title" | "description" | "venue" | "timezone" | "startsAt" | "endsAt">> & {
    status?: EventStatus;
  },
): Promise<boolean> {
  const _id = oid(id);
  if (!_id) return false;
  const db = await getDb();
  const r = await db.collection<Event>("events").updateOne(
    { _id, organizationId },
    { $set: { ...patch, updatedAt: new Date() } },
  );
  return r.matchedCount === 1;
}

export async function getTicketTypes(eventId: string): Promise<TicketType[]> {
  const db = await getDb();
  return db.collection<TicketType>("ticketTypes").find({ eventId }).toArray();
}

export async function createTicketType(
  eventId: string,
  input: {
    name: string;
    description: string;
    pricePaise: number;
    capacity: number;
    saleStartsAt?: Date | null;
    saleEndsAt?: Date | null;
  },
): Promise<TicketType> {
  const db = await getDb();
  const tt: TicketType = {
    eventId,
    name: input.name.trim(),
    description: input.description.trim(),
    pricePaise: Math.round(input.pricePaise),
    capacity: Math.max(1, Math.floor(input.capacity)),
    soldCount: 0,
    saleStartsAt: input.saleStartsAt ?? null,
    saleEndsAt: input.saleEndsAt ?? null,
  };
  const { insertedId } = await db.collection<TicketType>("ticketTypes").insertOne(tt);
  return { ...tt, _id: insertedId };
}
