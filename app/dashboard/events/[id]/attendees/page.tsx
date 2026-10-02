import { notFound } from "next/navigation";
import { AttendeesTable } from "@/components/features/attendees/attendees-table";
import { getEventAttendeeRows } from "@/lib/dashboard-data";
import { getOrgEvent } from "@/lib/events";
import { requireOrgSession } from "@/lib/guards";
import { can } from "@/lib/permissions";

export const metadata = { title: "Attendees" };

export default async function EventAttendeesPage({ params }: { params: Promise<{ id: string }> }) {
  const { org, role } = await requireOrgSession();
  const { id } = await params;
  const event = await getOrgEvent(id, org._id.toString());
  if (!event) notFound();
  const rows = await getEventAttendeeRows(id);
  return (
    <AttendeesTable
      eventId={id}
      rows={rows}
      canCheckIn={can(role, "checkIn") && event.status !== "CANCELLED"}
      exportHref={can(role, "export") ? "/api/export/attendees" : undefined}
    />
  );
}
