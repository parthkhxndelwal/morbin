import { EventsTable } from "@/components/features/events/events-table";
import { NewEventButton } from "@/components/features/events/new-event-button";
import { PageHeader } from "@/components/patterns/page-header";
import { getOrgEventRows } from "@/lib/dashboard-data";
import { requireOrgSession } from "@/lib/guards";
import { can } from "@/lib/permissions";

export const metadata = { title: "Events" };

export default async function EventsPage() {
  const { org, role } = await requireOrgSession();
  const canManage = can(role, "manageEvents") && org.status !== "SUSPENDED";
  const rows = await getOrgEventRows(org._id.toString());

  return (
    <div className="space-y-6">
      <PageHeader
        title="Events"
        description={
          canManage
            ? "Create events, set up tickets and booking, and publish when you're ready."
            : "Every event in your organisation. Open one to see its tickets and attendees."
        }
        actions={canManage ? <NewEventButton /> : undefined}
      />
      <EventsTable
        rows={rows}
        emptyAction={canManage ? <NewEventButton label="Create your first event" /> : undefined}
      />
    </div>
  );
}
