import { NoAccessState } from "@/components/patterns/states";
import { OrdersTable } from "@/components/features/orders/orders-table";
import { getOrgOrderRows } from "@/lib/dashboard-data";
import { requireEventAccess } from "@/lib/event-access";
import { can } from "@/lib/permissions";

export const metadata = { title: "Orders" };

export default async function EventOrdersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { org, role } = await requireEventAccess(id);
  const orgId = org._id.toString();
  if (!can(role, "view")) {
    return <NoAccessState description="Morbin support works on an event's setup and doesn't see its buyers' details." />;
  }
  const rows = await getOrgOrderRows(orgId, { eventId: id });
  return (
    <OrdersTable
      rows={rows}
      showEvent={false}
      canRefund={can(role, "refund")}
      exportHref={can(role, "export") ? `/api/export/orders?eventId=${id}` : undefined}
    />
  );
}
