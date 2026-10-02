import { notFound } from "next/navigation";
import { PageHeader } from "@/components/patterns/page-header";
import { NoAccessState } from "@/components/patterns/states";
import { getBranding } from "@/lib/branding";
import { getEventById } from "@/lib/events";
import { requireOrgSession } from "@/lib/guards";
import { can } from "@/lib/permissions";
import { AppearanceEditor } from "./editor";

export const metadata = { title: "Appearance" };

/**
 * Appearance and the fields the organizer wants to collect.
 *
 * The public page reads every value from here, so what an organizer sets is
 * exactly what a buyer sees — there is no second rendering path to keep in sync.
 */
export default async function AppearancePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { org, role } = await requireOrgSession();
  const { id } = await params;
  const event = await getEventById(id);
  if (!event || event.organizationId !== org._id.toString()) notFound();

  if (!can(role, "manageEvents")) {
    return (
      <NoAccessState description="Only the organisation owner can change how the page looks." />
    );
  }

  const branding = await getBranding(event._id!.toString());

  return (
    <div className="space-y-6">
      <PageHeader
        title="Appearance & fields"
        description="The banner, the booking button, and anything extra you want to ask at checkout."
      />
      <AppearanceEditor
        eventId={event._id!.toString()}
        slug={event.slug}
        title={event.title}
        venue={event.venue}
        startsAt={event.startsAt.toISOString()}
        timeZone={event.timezone}
        branding={{
          bannerKey: branding.bannerKey,
          socialImageKey: branding.socialImageKey,
          accentColor: branding.accentColor,
          ctaLabel: branding.ctaLabel,
          showDescription: branding.showDescription,
          showVenue: branding.showVenue,
          showDate: branding.showDate,
          showTicketPreview: branding.showTicketPreview,
          theme: branding.theme,
          customFields: branding.customFields,
        }}
      />
    </div>
  );
}
