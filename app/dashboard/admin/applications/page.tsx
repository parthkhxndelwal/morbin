import { ApplicationsTable } from "@/components/features/admin/applications-table";
import { CopyButton } from "@/components/patterns/copy-button";
import { PageHeader } from "@/components/patterns/page-header";
import { requireAdmin } from "@/lib/admin";
import { listApplications } from "@/lib/applications";
import { appUrl } from "@/lib/email";

export const metadata = { title: "Applications" };

export default async function AdminApplicationsPage() {
  await requireAdmin();
  const rows = await listApplications();
  const waiting = rows.filter((r) => r.status === "NEW").length;
  const formUrl = appUrl("/apply");
  return (
    <div className="space-y-6">
      <PageHeader
        title="Applications"
        description={
          <>
            {waiting > 0 ? `${waiting} waiting for a decision. ` : ""}Organisations apply at{" "}
            <span className="font-mono">{formUrl}</span> <CopyButton value={formUrl} label="Copy the application link" />
          </>
        }
      />
      <ApplicationsTable rows={rows} />
    </div>
  );
}
