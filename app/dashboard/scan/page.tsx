import { PageHeader } from "@/components/patterns/page-header";
import { getDb } from "@/lib/db";
import { requireOrgSession } from "@/lib/guards";
import type { Event } from "@/lib/types";
import { CheckinScanner, type ScannerEvent } from "./scanner";

export const metadata = { title: "Check-in" };

/**
 * The check-in desk.
 *
 * Authorises the session, then hands the scanner a plain list of the
 * organisation's own events to choose between — nearest upcoming first, so the
 * desk opens on the event being worked right now. Cancelled events are left out
 * (nobody works a cancelled door) and nothing else about an event is sent: the
 * scanner gets ids, titles and dates, never a document.
 */
export default async function ScanPage() {
  const { org } = await requireOrgSession();
  const now = new Date();
  const db = await getDb();
  const events = await db
    .collection<Event>("events")
    .find(
      { organizationId: org._id.toString(), status: { $ne: "CANCELLED" } },
      { projection: { title: 1, startsAt: 1, endsAt: 1, status: 1 } },
    )
    .sort({ startsAt: 1 })
    .limit(300)
    .toArray();

  const upcoming: ScannerEvent[] = [];
  const past: ScannerEvent[] = [];
  for (const event of events) {
    if (!event._id || event.status === "CANCELLED") continue;
    const row: ScannerEvent = {
      id: event._id.toString(),
      title: event.title,
      startsAt: event.startsAt.toISOString(),
      endsAt: event.endsAt.toISOString(),
      status: event.status,
      past: event.endsAt < now,
    };
    (event.endsAt >= now ? upcoming : past).push(row);
  }
  past.reverse();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Check-in"
        description="Scan a ticket's QR code with the camera, or type the code. Every ticket is admitted once."
      />
      <CheckinScanner events={[...upcoming, ...past]} />
    </div>
  );
}
