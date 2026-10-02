import { DataRequestsTable } from "@/components/features/admin/data-requests-table";
import { CopyButton } from "@/components/patterns/copy-button";
import { PageHeader } from "@/components/patterns/page-header";
import { requireAdmin } from "@/lib/admin";
import { appUrl } from "@/lib/email";
import { listDataRequests } from "@/lib/privacy";
import { DATA_REQUEST_DEADLINE_DAYS } from "@/lib/privacy-notice";

export const metadata = { title: "Data requests" };

/**
 * DPDP requests from people whose data Morbin holds. Only confirmed requests
 * appear; each must be answered within the statutory deadline.
 */
export default async function AdminDataRequestsPage() {
  await requireAdmin();
  const rows = await listDataRequests();
  const open = rows.filter((r) => r.status === "OPEN").length;
  const formUrl = appUrl("/privacy/request");
  return (
    <div className="space-y-6">
      <PageHeader
        title="Data requests"
        description={
          <>
            {open > 0 ? `${open} to answer. ` : ""}Each must be answered within {DATA_REQUEST_DEADLINE_DAYS} days of being
            confirmed. People ask at <span className="font-mono">{formUrl}</span>{" "}
            <CopyButton value={formUrl} label="Copy the request link" />
          </>
        }
      />
      <DataRequestsTable rows={rows} />
    </div>
  );
}
