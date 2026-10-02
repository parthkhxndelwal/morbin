import { notFound } from "next/navigation";
import { AdminPayoutActions, PayoutAccountCard } from "@/components/features/payouts/admin-desk";
import { PayoutSummary, PayoutThread } from "@/components/features/payouts/payout-detail";
import { BreadcrumbLabel } from "@/components/breadcrumb-labels";
import { Money } from "@/components/patterns/money";
import { PageHeader } from "@/components/patterns/page-header";
import { StatusBadge } from "@/components/patterns/status-badge";
import { requireAdmin } from "@/lib/admin";
import { getPayoutDetail } from "@/lib/dashboard-data";
import { getPayoutAccountView } from "@/lib/payout-accounts";

export const metadata = { title: "Payout" };

export default async function AdminPayoutPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const payout = await getPayoutDetail(id, null);
  if (!payout) notFound();
  const account = await getPayoutAccountView(payout.organizationId);

  return (
    <div className="space-y-6">
      <BreadcrumbLabel segment={id} label={payout.organizationName ?? "Payout"} />
      <PageHeader
        title={<Money paise={payout.netPaise} />}
        meta={<StatusBadge kind="payout" value={payout.status} />}
        description={`${payout.organizationName ?? "Organisation"} · ${payout.entryCount} ledger entries`}
        actions={<AdminPayoutActions payout={payout} />}
      />
      <PayoutSummary payout={payout} />
      <div className="grid gap-4 lg:grid-cols-2">
        <PayoutAccountCard
          organizationId={payout.organizationId}
          account={
            account && {
              accountName: account.accountName,
              ifsc: account.ifsc,
              last4: account.last4,
              verified: !!account.verifiedAt,
            }
          }
        />
        <PayoutThread payout={payout} />
      </div>
    </div>
  );
}
