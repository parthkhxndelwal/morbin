import { PayableOrgsTable } from "@/components/features/payouts/admin-desk";
import { PayoutsTable } from "@/components/features/payouts/payouts-table";
import { PageHeader } from "@/components/patterns/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdmin } from "@/lib/admin";
import { getPayableOrgs } from "@/lib/admin-desk";
import { getPayoutRows } from "@/lib/dashboard-data";

export const metadata = { title: "Payouts" };

/**
 * The payouts desk: who is owed money, and every payout across organisations.
 * There is no schedule — a payout exists only when an admin issues it here.
 */
export default async function AdminPayoutsPage() {
  await requireAdmin();
  const [payable, payouts] = await Promise.all([getPayableOrgs(), getPayoutRows(null)]);
  const queries = payouts.filter((p) => p.status === "DISPUTED").length;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Payouts"
        description={
          queries > 0
            ? `${queries} payout ${queries === 1 ? "query is" : "queries are"} waiting for a reply.`
            : "Issue a payout, transfer the money, then mark it paid with the UTR and statement."
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>Owed to organisations</CardTitle>
          <CardDescription>Unsettled balances, net of fees, refunds and refund costs.</CardDescription>
        </CardHeader>
        <CardContent>
          <PayableOrgsTable rows={payable} />
        </CardContent>
      </Card>
      <PayoutsTable rows={payouts} basePath="/dashboard/admin/payouts" showOrganisation />
    </div>
  );
}
