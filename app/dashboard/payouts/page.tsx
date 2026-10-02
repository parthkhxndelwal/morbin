import { PayoutsTable } from "@/components/features/payouts/payouts-table";
import { Money } from "@/components/patterns/money";
import { PageHeader } from "@/components/patterns/page-header";
import { StatCard, StatGrid } from "@/components/patterns/stat-card";
import { NoAccessState } from "@/components/patterns/states";
import { getPayoutRows } from "@/lib/dashboard-data";
import { requireOrgSession } from "@/lib/guards";
import { getOrgBalance } from "@/lib/ledger";
import { can } from "@/lib/permissions";

export const metadata = { title: "Payouts" };

export default async function PayoutsPage() {
  const { org, role } = await requireOrgSession();
  if (!can(role, "finance")) return <NoAccessState description="Payouts are visible to the organisation owner." />;
  const orgId = org._id.toString();
  const [balance, rows] = await Promise.all([getOrgBalance(orgId), getPayoutRows(orgId)]);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Payouts"
        description="What Morbin owes you and every transfer made so far. Each payout comes with a statement you can check and acknowledge."
      />
      <StatGrid>
        <StatCard
          label="Unpaid balance"
          value={<Money paise={balance.unsettledPaise} />}
          hint="Sales minus fees, refunds and holds, not yet in a payout."
        />
        <StatCard label="Being prepared" value={<Money paise={balance.inDraftPaise} />} hint="In a payout Morbin is processing." />
        <StatCard label="Paid out" value={<Money paise={balance.paidOutPaise} />} hint="All transfers to date." />
        <StatCard
          label="Refunds held"
          value={<Money paise={-balance.unsettled.refundsPaise - balance.unsettled.refundCostsPaise} />}
          hint="Deducted from your balance for pending and completed refunds."
        />
      </StatGrid>
      <PayoutsTable rows={rows} basePath="/dashboard/payouts" />
    </div>
  );
}
