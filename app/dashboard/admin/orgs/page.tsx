import { NewOrganizationButton, OrgsTable } from "@/components/features/admin/orgs-table";
import { PageHeader } from "@/components/patterns/page-header";
import { listOrganizations, requireAdmin } from "@/lib/admin";

export const metadata = { title: "Organisations" };

export default async function AdminOrganisationsPage() {
  await requireAdmin();
  const rows = await listOrganizations();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Organisations"
        description="Everyone selling tickets on Morbin. Open one to manage its fee, members, events and money."
        actions={<NewOrganizationButton />}
      />
      <OrgsTable
        rows={rows.map((r) => ({
          id: r.org.id,
          name: r.org.name,
          type: r.org.type,
          status: r.org.status,
          paymentAccountStatus: r.org.paymentAccountStatus,
          ownerEmail: r.owner?.email ?? null,
          events: r.eventCount,
          orders: r.org.orderCount,
          createdAt: r.org.createdAt,
        }))}
      />
    </div>
  );
}
