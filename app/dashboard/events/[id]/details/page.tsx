import { notFound } from "next/navigation";
import { EventDetailsForm } from "@/components/features/events/event-details-form";
import { NoAccessState } from "@/components/patterns/states";
import { appUrl } from "@/lib/email";
import { getOrgEvent } from "@/lib/events";
import { requireOrgSession } from "@/lib/guards";
import { can } from "@/lib/permissions";
import { feeBearerFor, feeBpsFor, getPlatformSettings } from "@/lib/platform-settings";
import { toLocalDateTimeInput } from "@/lib/validations";

export const metadata = { title: "Details" };

export default async function EventDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { org, role } = await requireOrgSession();
  const { id } = await params;
  const event = await getOrgEvent(id, org._id.toString());
  if (!event) notFound();
  if (!can(role, "manageEvents")) {
    return <NoAccessState description="Only the organisation owner can edit event details." />;
  }
  const settings = await getPlatformSettings();
  return (
    <EventDetailsForm
      eventId={id}
      defaults={{
        title: event.title,
        description: event.description,
        venue: event.venue,
        startsAt: toLocalDateTimeInput(event.startsAt),
        endsAt: toLocalDateTimeInput(event.endsAt),
      }}
      slug={event.slug}
      feeBearer={event.feeBearer ?? null}
      orgFeeBearer={feeBearerFor(org)}
      feeBps={feeBpsFor(org, settings)}
      gstBps={settings.gst.rateBps}
      disabled={event.status === "CANCELLED" || org.status === "SUSPENDED"}
      appOrigin={appUrl()}
    />
  );
}
