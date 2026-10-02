import { NoAccessState } from "@/components/patterns/states";
import { AttendeesTable } from "@/components/features/attendees/attendees-table";
import { getEventAttendeeRows } from "@/lib/dashboard-data";
import { requireEventAccess } from "@/lib/event-access";
import { can } from "@/lib/permissions";

export const metadata = { title: "Attendees" };

export default async function EventAttendeesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { role, event } = await requireEventAccess(id);
  if (!can(role, "view")) {
    return <NoAccessState description="Morbin support works on an event's setup and doesn't see its buyers' details." />;
  }
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
