import type { Metadata } from "next";
import Link from "next/link";
import { CalendarIcon, ExternalLinkIcon, LifeBuoyIcon, MapPinIcon } from "lucide-react";
import { BreadcrumbLabel } from "@/components/breadcrumb-labels";
import { EventTabs, type EventTab } from "@/components/features/events/event-tabs";
import { CopyButton } from "@/components/patterns/copy-button";
import { DateTime } from "@/components/patterns/money";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { appUrl } from "@/lib/email";
import { resolveEventAccess, requireEventAccess } from "@/lib/event-access";
import { can } from "@/lib/permissions";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const access = await resolveEventAccess(id);
  const name = access && access !== "signed-out" ? access.event.title : "Event";
  // Tab pages ("Orders"…) read "Orders · Fest — Morbin".
  return { title: { default: name, template: `%s · ${name} — Morbin` } };
}

/**
 * Shared frame for every page of one event: the header (name, status, when,
 * where, public link) and the section tabs. Access comes from
 * `requireEventAccess`: the event's own organisation, or a Morbin admin as
 * support (setup tabs only, with a banner); a 404 for anyone else.
 */
export default async function EventLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { org, role, event, support } = await requireEventAccess(id);

  const ended = event.endsAt < new Date();
  const status = event.status === "PUBLISHED" && ended ? "ENDED" : event.status;
  const publicPath = `/event/${event.slug}`;
  const manage = can(role, "manageEvents");

  const tabs: EventTab[] = [
    { label: "Overview", path: "" },
    ...(manage ? [{ label: "Details", path: "details" }] : []),
    ...(manage
      ? [
          { label: "Booking rules", path: "flow" },
          { label: "Appearance", path: "appearance" },
        ]
      : []),
    ...(can(role, "view")
      ? [
          { label: "Orders", path: "orders" },
          { label: "Attendees", path: "attendees" },
          { label: "Insights", path: "insights" },
        ]
      : []),
  ];

  return (
    <div className="space-y-6">
      <BreadcrumbLabel segment={id} label={event.title} />
      {support && (
        <Alert>
          <LifeBuoyIcon />
          <AlertTitle>Editing as Morbin support for {org.name}</AlertTitle>
          <AlertDescription>
            <p>
              Changes are visible to the organisation: each one is logged and the owner is notified.
              {org.requireApprovalForSupportChanges
                ? " This organisation reviews support changes, so booking rules are saved as a draft for the owner to publish, and the event can't be published or cancelled from here."
                : ""}
            </p>
            <Link href={`/dashboard/admin/orgs/${org._id.toString()}`} className="underline underline-offset-4">
              Back to {org.name}
            </Link>
          </AlertDescription>
        </Alert>
      )}
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
