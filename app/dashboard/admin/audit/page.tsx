import { AuditTable, FailedEmails } from "@/components/features/admin/audit-table";
import { PageHeader } from "@/components/patterns/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdmin } from "@/lib/admin";
import { getAuditRows, getFailedEmails } from "@/lib/admin-desk";

export const metadata = { title: "Audit log" };

export default async function AdminAuditPage() {
  await requireAdmin();
  const [rows, failed] = await Promise.all([getAuditRows(), getFailedEmails()]);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit log"
        description="Every change to money, organisations and access, with who made it. Entries never contain personal details."
      />
      {failed.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Undelivered emails</CardTitle>
            <CardDescription>These failed after every retry. Tickets, refunds and invites may not have reached people.</CardDescription>
          </CardHeader>
          <CardContent>
            <FailedEmails rows={failed} />
          </CardContent>
        </Card>
      )}
      <AuditTable rows={rows} />
    </div>
  );
}
