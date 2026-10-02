import { notFound } from "next/navigation";
import { OrdersTable } from "@/components/features/orders/orders-table";
import { getOrgOrderRows } from "@/lib/dashboard-data";
import { getOrgEvent } from "@/lib/events";
import { requireOrgSession } from "@/lib/guards";
import { can } from "@/lib/permissions";

export const metadata = { title: "Orders" };

export default async function EventOrdersPage({ params }: { params: Promise<{ id: string }> }) {
  const { org, role } = await requireOrgSession();
  const { id } = await params;
  const orgId = org._id.toString();
  if (!(await getOrgEvent(id, orgId))) notFound();
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
