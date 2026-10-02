import { RefundCasesTable } from "@/components/features/refunds/refund-cases";
import { PageHeader } from "@/components/patterns/page-header";
import { NoAccessState } from "@/components/patterns/states";
import { getRefundRows } from "@/lib/dashboard-data";
import { requireOrgSession } from "@/lib/guards";
import { can } from "@/lib/permissions";

export const metadata = { title: "Refunds" };

export default async function RefundsPage() {
  const { org, role } = await requireOrgSession();
  if (!can(role, "refund")) return <NoAccessState description="Refunds are handled by the organisation owner." />;
  const rows = await getRefundRows(org._id.toString());
  return (
    <div className="space-y-6">
      <PageHeader
        title="Refunds"
        description="Every refund you've requested and where it stands. Ticket value only — convenience fees are never refunded."
      />
      <RefundCasesTable rows={rows} viewer="OWNER" />
    </div>
  );
}
