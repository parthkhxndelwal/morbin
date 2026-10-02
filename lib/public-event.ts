import "server-only";

import { cache } from "react";
import { getBranding } from "@/lib/branding";
import { getDb, toObjectId } from "@/lib/db";
import { publicMediaUrl as mediaUrl } from "@/lib/media-public";
import { feeBearerFor } from "@/lib/platform-settings";
import type { Event, EventBranding, Organization, TicketType } from "@/lib/types";

/**
 * Everything the public event page renders, as plain data.
 *
 * Unlike `getPublishedEventBySlug` (checkout's loader), this also returns
 * cancelled and ended events so their pages can say so instead of 404ing.
 * Drafts are returned only for a builder test run of that same event.
 */

export type PublicEventState = "ON_SALE" | "CANCELLED" | "ENDED" | "SOLD_OUT" | "NOT_ON_SALE";

export interface PublicTicket {
  id: string;
  name: string;
  description: string;
  pricePaise: number;
  state: "AVAILABLE" | "SOLD_OUT" | "PAUSED" | "NOT_YET" | "CLOSED";
  saleStartsAt: string | null;
}

export interface PublicEvent {
  id: string;
  slug: string;
  title: string;
  description: string;
  venue: string;
  timezone: string;
  startsAt: string;
  endsAt: string;
  status: Event["status"];
  state: PublicEventState;
  /** When nothing is on sale yet: the earliest time something will be. */
  salesOpenAt: string | null;
  organizerName: string;
  bannerUrl: string | null;
  branding: Pick<EventBranding, "accentColor" | "ctaLabel" | "showDescription" | "showVenue" | "showDate" | "showTicketPreview">;
  /** The customer pays the convenience fee on top ("+ convenience fee"). */
  customerPaysFee: boolean;
  tickets: PublicTicket[];
  fromPaise: number | null;
}

function ticketState(t: TicketType, now: Date): PublicTicket["state"] {
  if (t.status === "PAUSED") return "PAUSED";
  if (t.saleEndsAt && t.saleEndsAt < now) return "CLOSED";
  if (t.saleStartsAt && t.saleStartsAt > now) return "NOT_YET";
  if (t.soldCount >= t.capacity) return "SOLD_OUT";
  return "AVAILABLE";
}

export const getPublicEvent = cache(
  async (slug: string, opts: { draftEventId?: string | null } = {}): Promise<PublicEvent | null> => {
    const db = await getDb();
    const event = await db.collection<Event>("events").findOne({ slug });
    if (!event?._id) return null;
    const id = event._id.toString();
    if (event.status === "DRAFT" && opts.draftEventId !== id) return null;

    const [types, branding, org] = await Promise.all([
      db.collection<TicketType>("ticketTypes").find({ eventId: id }).sort({ pricePaise: 1 }).toArray(),
      getBranding(id),
      db
        .collection<Organization>("organizations")
        .findOne({ _id: toObjectId(event.organizationId)! }, { projection: { name: 1, feeBearer: 1 } }),
    ]);
    const now = new Date();
    const tickets: PublicTicket[] = types
      .filter((t) => t.status !== "HIDDEN")
      .map((t) => ({
        id: t._id!.toString(),
        name: t.name,
        description: t.description,
        pricePaise: t.pricePaise,
        state: ticketState(t, now),
        saleStartsAt: t.saleStartsAt ? t.saleStartsAt.toISOString() : null,
      }));
    const available = tickets.filter((t) => t.state === "AVAILABLE");
    const upcoming = tickets.filter((t) => t.state === "NOT_YET").map((t) => t.saleStartsAt!).sort();

    let state: PublicEventState = "ON_SALE";
    if (event.status === "CANCELLED") state = "CANCELLED";
    else if (event.endsAt < now) state = "ENDED";
    else if (available.length === 0 && upcoming.length > 0) state = "NOT_ON_SALE";
    else if (available.length === 0) state = "SOLD_OUT";

    return {
      id,
      slug: event.slug,
      title: event.title,
      description: event.description,
      venue: event.venue,
      timezone: event.timezone || "Asia/Kolkata",
      startsAt: event.startsAt.toISOString(),
      endsAt: event.endsAt.toISOString(),
      status: event.status,
      state,
      salesOpenAt: state === "NOT_ON_SALE" ? upcoming[0] : null,
      organizerName: org?.name ?? "",
      bannerUrl: branding.bannerKey ? mediaUrl(branding.bannerKey) : null,
      branding: {
        accentColor: branding.accentColor,
        ctaLabel: branding.ctaLabel,
        showDescription: branding.showDescription,
        showVenue: branding.showVenue,
        showDate: branding.showDate,
        showTicketPreview: branding.showTicketPreview,
      },
      customerPaysFee: feeBearerFor(org ?? {}, event) === "CUSTOMER",
      tickets,
      fromPaise: (available.length ? available : tickets).reduce<number | null>(
        (min, t) => (min === null ? t.pricePaise : Math.min(min, t.pricePaise)),
        null,
      ),
    };
  },
);
