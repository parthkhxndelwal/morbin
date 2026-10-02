import { notFound } from "next/navigation";
import { OwnerPayoutActions, PayoutSummary, PayoutThread } from "@/components/features/payouts/payout-detail";
import { BreadcrumbLabel } from "@/components/breadcrumb-labels";
import { Money } from "@/components/patterns/money";
import { PageHeader } from "@/components/patterns/page-header";
import { StatusBadge } from "@/components/patterns/status-badge";
import { NoAccessState } from "@/components/patterns/states";
import { getPayoutDetail } from "@/lib/dashboard-data";
import { requireOrgSession } from "@/lib/guards";
import { can } from "@/lib/permissions";

export const metadata = { title: "Payout" };

export default async function PayoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { org, role } = await requireOrgSession();
  if (!can(role, "finance")) return <NoAccessState description="Payouts are visible to the organisation owner." />;
  const payout = await getPayoutDetail(id, org._id.toString());
  if (!payout) notFound();
  return (
    <div className="space-y-6">
      <BreadcrumbLabel segment={id} label="Payout" />
      <PageHeader
        title={<Money paise={payout.netPaise} />}
        meta={<StatusBadge kind="payout" value={payout.status} />}
        description="Check the statement against your records, then acknowledge it or raise a query."
        actions={<OwnerPayoutActions payout={payout} />}
      />
      <PayoutSummary payout={payout} />
      <PayoutThread payout={payout} />
    </div>
  );
}
