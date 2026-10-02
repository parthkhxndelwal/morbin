import { RefundCasesTable } from "@/components/features/refunds/refund-cases";
import { PageHeader } from "@/components/patterns/page-header";
import { Badge } from "@/components/ui/badge";
import { requireAdmin } from "@/lib/admin";
import { getRefundRows } from "@/lib/dashboard-data";
import { formatINR } from "@/lib/format";
import { fetchBalance } from "@/lib/razorpay";

export const metadata = { title: "Refunds" };

/**
 * Refund requests from every organisation. Approving one that Morbin settles
 * sends it to Razorpay straight away; failures can be retried (Razorpay is
 * checked first, so never twice) or completed manually with a reference.
 */
export default async function AdminRefundsPage() {
  await requireAdmin();
  const [rows, balance] = await Promise.all([getRefundRows(null), fetchBalance()]);
  const waiting = rows.filter((r) => r.status === "REQUESTED").length;
  const failed = rows.filter((r) => r.status === "FAILED").length;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Refunds"
        description={
          waiting || failed
            ? [waiting && `${waiting} awaiting approval`, failed && `${failed} failed at Razorpay`].filter(Boolean).join(" · ")
            : "Refund requests from organisations. Ticket value only — convenience fees are never refunded."
        }
        meta={
          <Badge variant={balance.available ? "secondary" : "outline"} title={balance.available ? `As of ${balance.fetchedAt}` : balance.reason}>
            {balance.available ? `Razorpay balance: ${formatINR(balance.balancePaise)}` : "Razorpay balance unavailable"}
          </Badge>
        }
      />
      {!balance.available && (
        <p className="-mt-3 text-sm text-muted-foreground">Balance unavailable: {balance.reason}. Check the Razorpay dashboard before approving.</p>
      )}
      <RefundCasesTable rows={rows} viewer="ADMIN" balancePaise={balance.available ? balance.balancePaise : null} />
    </div>
  );
}
