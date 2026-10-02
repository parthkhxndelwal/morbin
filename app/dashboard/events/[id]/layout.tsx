import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CalendarIcon, ExternalLinkIcon, MapPinIcon } from "lucide-react";
import { BreadcrumbLabel } from "@/components/breadcrumb-labels";
import { EventTabs, type EventTab } from "@/components/features/events/event-tabs";
import { CopyButton } from "@/components/patterns/copy-button";
import { DateTime } from "@/components/patterns/money";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Button } from "@/components/ui/button";
import { getOrgEvent } from "@/lib/events";
import { appUrl } from "@/lib/email";
import { requireOrgSession } from "@/lib/guards";
import { can } from "@/lib/permissions";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { org } = await requireOrgSession();
  const { id } = await params;
  const event = await getOrgEvent(id, org._id.toString());
  const name = event?.title ?? "Event";
  // Tab pages ("Booking flow", "Orders"…) read "Booking flow · Fest — Morbin".
  return { title: { default: name, template: `%s · ${name} — Morbin` } };
}

/**
 * Shared frame for every page of one event: the header (name, status, when,
 * where, public link) and the section tabs. The event is loaded once here,
 * scoped to the caller's organisation, and 404s for anyone else's id.
 */
export default async function EventLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { org, role } = await requireOrgSession();
  const { id } = await params;
  const event = await getOrgEvent(id, org._id.toString());
  if (!event) notFound();

  const ended = event.endsAt < new Date();
  const status = event.status === "PUBLISHED" && ended ? "ENDED" : event.status;
  const publicPath = `/event/${event.slug}`;
  const manage = can(role, "manageEvents");

  const tabs: EventTab[] = [
    { label: "Overview", path: "" },
    ...(manage ? [{ label: "Details", path: "details" }] : []),
    ...(manage
      ? [
          { label: "Booking flow", path: "flow" },
          { label: "Appearance", path: "appearance" },
        ]
      : []),
    { label: "Orders", path: "orders" },
    { label: "Attendees", path: "attendees" },
    { label: "Insights", path: "insights" },
  ];

  return (
    <div className="space-y-6">
      <BreadcrumbLabel segment={id} label={event.title} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{event.title}</h1>
            <StatusBadge kind="event" value={status} />
          </div>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <CalendarIcon className="size-3.5" />
              <DateTime value={event.startsAt} timeZone={event.timezone} />
            </span>
            <span className="inline-flex items-center gap-1.5">
              <MapPinIcon className="size-3.5" />
              {event.venue}
            </span>
          </p>
        </div>
        {event.status === "PUBLISHED" && !ended && (
          <div className="flex shrink-0 items-center gap-2">
            <CopyButton value={appUrl(publicPath)} label="Copy public link" />
            <Button
              variant="outline"
              size="sm"
              render={<a href={publicPath} target="_blank" rel="noreferrer" />}
              nativeButton={false}
            >
              <ExternalLinkIcon data-icon="inline-start" />
              View page
            </Button>
          </div>
        )}
      </div>
      <EventTabs eventId={id} tabs={tabs} />
      {children}
    </div>
  );
}
