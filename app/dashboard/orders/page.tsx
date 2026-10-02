import { OrdersTable } from "@/components/features/orders/orders-table";
import { PageHeader } from "@/components/patterns/page-header";
import { getOrgOrderRows } from "@/lib/dashboard-data";
import { requireOrgSession } from "@/lib/guards";
import { can } from "@/lib/permissions";

export const metadata = { title: "Orders" };

export default async function OrdersPage() {
  const { org, role } = await requireOrgSession();
  const rows = await getOrgOrderRows(org._id.toString());
  return (
    <div className="space-y-6">
      <PageHeader
        title="Orders"
        description="Every booking across your events. Open an order to see what was paid, its tickets, and refunds."
      />
      <OrdersTable
        rows={rows}
        canRefund={can(role, "refund")}
        exportHref={can(role, "export") ? "/api/export/orders" : undefined}
      />
    </div>
  );
}
