import { RefundCasesTable } from "@/components/features/refunds/refund-cases";
import { PageHeader } from "@/components/patterns/page-header";
import { requireAdmin } from "@/lib/admin";
import { getRefundRows } from "@/lib/dashboard-data";

export const metadata = { title: "Refunds" };

/**
 * Refund requests from every organisation. Approving one that Morbin settles
 * sends it to Razorpay straight away; failures can be retried (Razorpay is
 * checked first, so never twice) or completed manually with a reference.
 */
export default async function AdminRefundsPage() {
  await requireAdmin();
  const rows = await getRefundRows(null);
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
      />
      <RefundCasesTable rows={rows} viewer="ADMIN" />
    </div>
  );
}
