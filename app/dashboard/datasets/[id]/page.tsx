import { notFound } from "next/navigation";
import { DatasetView } from "@/components/features/datasets/dataset-view";
import { getDataset, listRows } from "@/lib/datasets";
import { requireOrgSession } from "@/lib/guards";
import { can } from "@/lib/permissions";

export const metadata = { title: "Dataset" };

export default async function DatasetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { org, role } = await requireOrgSession();
  if (!can(role, "manageDatasets")) notFound();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const orgId = org._id.toString();
  const dataset = await getDataset(orgId, id);
  if (!dataset) notFound();
  const page = await listRows(orgId, id, { q: sp.q, page: Number(sp.page) || 1 });
  return <DatasetView dataset={dataset} page={page} basePath="/dashboard/datasets" supportOrgId={null} canExport={can(role, "export")} />;
}
