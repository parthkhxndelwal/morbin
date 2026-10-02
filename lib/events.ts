import { cache } from "react";
import { getDb, toObjectId } from "@/lib/db";
import { isValidSlug, normaliseSlug, slugify, withSlugSuffix } from "@/lib/slug";
import type { Event, EventStatus, TicketType } from "@/lib/types";

export async function getOrgEvents(organizationId: string): Promise<Event[]> {
  const db = await getDb();
  return db
    .collection<Event>("events")
    .find({ organizationId })
    .sort({ createdAt: -1 })
    .toArray();
}

export async function getEventById(id: string): Promise<Event | null> {
  const _id = toObjectId(id);
  if (!_id) return null;
  const db = await getDb();
  return db.collection<Event>("events").findOne({ _id });
}

/**
 * Find an unused slug, derived from `desired` and disambiguated on collision.
 *
 * Collisions are checked against the whole collection, not just one
 * organization, because slugs are globally unique and appear in public URLs.
 */
async function resolveAvailableSlug(desired: string): Promise<string> {
  const db = await getDb();
  let candidate = desired;
  for (let i = 0; i < 6; i++) {
    const taken = await db.collection("events").findOne({ slug: candidate });
    if (!taken) return candidate;
    candidate = withSlugSuffix(desired);
  }
  // Astronomically unlikely; guarantees we always return something storable.
  return withSlugSuffix(`${desired}-${Date.now().toString(36)}`);
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
    slug?: string;
  },
): Promise<Event> {
  const desired = normaliseSlug(input.slug, input.title) ?? "event";
  const slug = await resolveAvailableSlug(desired);
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
  const db = await getDb();
  const { insertedId } = await db.collection<Event>("events").insertOne(event);
  return { ...event, _id: insertedId };
}

export async function updateEvent(
  id: string,
  organizationId: string,
  patch: Partial<
    Pick<Event, "title" | "description" | "venue" | "timezone" | "startsAt" | "endsAt">
  > & { status?: EventStatus },
): Promise<boolean> {
  const _id = toObjectId(id);
  if (!_id) return false;
  const db = await getDb();
  const r = await db
    .collection<Event>("events")
    .updateOne({ _id, organizationId }, { $set: { ...patch, updatedAt: new Date() } });
  return r.matchedCount === 1;
}

/**
 * Change an event's public slug. Refuses when the value is malformed or already
 * taken, so a mistyped slug can never take an event's page offline.
 */
export async function updateEventSlug(
  id: string,
  organizationId: string,
  rawSlug: string,
): Promise<{ ok: true; slug: string } | { ok: false; error: string }> {
  const _id = toObjectId(id);
  if (!_id) return { ok: false, error: "Invalid event" };
  const slug = slugify(rawSlug);
  if (!isValidSlug(slug)) {
    return {
      ok: false,
      error: "Use lowercase letters, numbers and single dashes (e.g. krmu-ideas-4-0).",
    };
  }
  const db = await getDb();
  const current = await db
    .collection<Event>("events")
    .findOne({ _id, organizationId }, { projection: { slug: 1 } });
  if (!current) return { ok: false, error: "Event not found" };
  if (current.slug === slug) return { ok: true, slug };

  const taken = await db.collection("events").findOne({ slug, _id: { $ne: _id } });
  if (taken) return { ok: false, error: `/${slug} is already taken by another event.` };

  await db
    .collection<Event>("events")
    .updateOne({ _id, organizationId }, { $set: { slug, updatedAt: new Date() } });
  return { ok: true, slug };
}

/**
 * Ticket types for an event, cheapest first.
 *
 * The sort is load-bearing, not cosmetic. A branch with `quantityEditable: false`
 * has its order contents decided by picking the first type the buyer may buy, so
 * an unsorted read would make "the one free student ticket" depend on Mongo's
 * natural order — and could silently charge someone for the paid type.
 */
export async function getTicketTypes(eventId: string): Promise<TicketType[]> {
  const db = await getDb();
  return db
    .collection<TicketType>("ticketTypes")
    .find({ eventId })
    .sort({ pricePaise: 1, name: 1 })
    .toArray();
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
    defaultMaxPerOrder?: number | null;
    audienceOptionIds?: string[] | null;
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
    // Unset means "no opinion from the organizer" — the flow's own cap applies
    // alone, and the checkout falls back to the global per-order limit.
    defaultMaxPerOrder: input.defaultMaxPerOrder ?? null,
    audienceOptionIds: input.audienceOptionIds ?? null,
  };
  const { insertedId } = await db.collection<TicketType>("ticketTypes").insertOne(tt);
  return { ...tt, _id: insertedId };
}

/**
 * Create an event together with the documents every event needs: a permissive
 * checkout flow and default appearance. The one path both the API route and the
 * dashboard action use, so a new event is never half-seeded.
 */
export async function createEventWithDefaults(
  organizationId: string,
  input: Parameters<typeof createEvent>[1],
): Promise<Event> {
  const event = await createEvent(organizationId, input);
  const eventId = event._id!.toString();
  try {
    const [{ createFlow, permissiveFlow }, { getBranding }] = await Promise.all([
      import("@/lib/flows"),
      import("@/lib/branding"),
    ]);
    await createFlow(permissiveFlow(eventId));
    await getBranding(eventId);
  } catch (error) {
    // Readers fall back to equivalent defaults, so a partial seed is harmless.
    console.error("[events:seed]", error);
  }
  return event;
}

/**
 * An event, only if it belongs to `organizationId` — the tenancy check is in
 * the query, not a post-check. Request-cached so an event's layout and page
 * share one read.
 */
export const getOrgEvent = cache(
  async (id: string, organizationId: string): Promise<(Event & { _id: NonNullable<Event["_id"]> }) | null> => {
    const _id = toObjectId(id);
    if (!_id) return null;
    const db = await getDb();
    const event = await db.collection<Event>("events").findOne({ _id, organizationId });
    return event?._id ? (event as Event & { _id: NonNullable<Event["_id"]> }) : null;
  },
);
