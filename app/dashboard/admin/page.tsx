import { listOrganizations, requireAdmin } from "@/lib/admin";
import { AdminOrgs } from "./orgs";

export const metadata = { title: "Organizations" };

export default async function AdminPage() {
  // The nested layout already gated on admin; re-checked here so the data
  // fetch itself can never run for a non-admin.
  await requireAdmin();
  const rows = await listOrganizations();

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Organizations</h1>
      <p className="mt-1 text-sm text-neutral-400">
        Create organizations, verify them, approve them, and manage who belongs to
        them.
      </p>
      <div className="mt-8">
        <AdminOrgs initialRows={rows} />
      </div>
    </div>
  );
}
