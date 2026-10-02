import { getDb } from "@/lib/db";
import { mediaBucket } from "@/lib/media";
import type { EventBranding } from "@/lib/types";

/**
 * Appearance defaults for a new event.
 *
 * Chosen to look correct with zero configuration, so publishing an event
 * immediately produces a presentable page. The organizer overrides any of it
 * from the dashboard's Appearance tab.
 */
export function defaultBranding(eventId: string): EventBranding {
  const now = new Date();
  return {
    eventId,
    bannerKey: null,
    socialImageKey: null,
    accentColor: "#7c3aed",
    ctaLabel: "Book Tickets Now",
    showDescription: true,
    showVenue: true,
    showDate: true,
    showTicketPreview: true,
    theme: "dark",
    customFields: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** Branding for an event, materialising defaults on first read. */
export async function getBranding(eventId: string): Promise<EventBranding> {
  const db = await getDb();
  const found = await db.collection<EventBranding>("eventBranding").findOne({ eventId });
  if (found) return found;
  const created = defaultBranding(eventId);
  try {
    await db.collection<EventBranding>("eventBranding").insertOne(created);
  } catch {
    // A concurrent request won the race; its copy is equivalent.
  }
  return created;
}

export async function saveBranding(
  eventId: string,
  patch: Partial<Omit<EventBranding, "eventId" | "createdAt">>,
): Promise<EventBranding> {
  const db = await getDb();
  const update = { ...patch, eventId, updatedAt: new Date() };
  // The document as it was just before this write (atomically), so the banner
  // being replaced is known exactly even if two saves race.
  const previous = await db
    .collection<EventBranding>("eventBranding")
    .findOneAndUpdate(
      { eventId },
      { $set: update, $setOnInsert: { createdAt: new Date() } },
      { upsert: true, returnDocument: "before", projection: { bannerKey: 1 } },
    );
  // A replaced or removed banner is deleted from disk rather than left behind:
  // nothing references it any more, and storage on this server is finite.
  const old = previous?.bannerKey;
  if (patch.bannerKey !== undefined && old && old !== patch.bannerKey) {
    await mediaBucket().delete(old);
  }
  return getBranding(eventId);
}
