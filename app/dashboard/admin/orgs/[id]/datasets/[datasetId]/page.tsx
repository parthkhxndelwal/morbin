import { notFound } from "next/navigation";
import { BreadcrumbLabel } from "@/components/breadcrumb-labels";
import { DatasetView } from "@/components/features/datasets/dataset-view";
import { DatasetSupportBanner } from "@/components/features/datasets/support-banner";
import { requireAdmin } from "@/lib/admin";
import { getDb, toObjectId } from "@/lib/db";
import { getDataset, listRows } from "@/lib/datasets";
import type { Organization } from "@/lib/types";

export const metadata = { title: "Dataset" };

/**
 * One dataset, as support. Same view as the owner's, minus export: support
 * never downloads an organisation's personal data.
 */
export default async function AdminDatasetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; datasetId: string }>;
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  await requireAdmin();
  const [{ id, datasetId }, sp] = await Promise.all([params, searchParams]);
  const _id = toObjectId(id);
  const org = _id ? await (await getDb()).collection<Organization>("organizations").findOne({ _id }, { projection: { name: 1 } }) : null;
  if (!org) notFound();
  const dataset = await getDataset(id, datasetId);
  if (!dataset) notFound();
  const page = await listRows(id, datasetId, { q: sp.q, page: Number(sp.page) || 1 });
  return (
    <div className="space-y-6">
      <BreadcrumbLabel segment={id} label={org.name} />
      <DatasetSupportBanner orgId={id} orgName={org.name} />
      <DatasetView dataset={dataset} page={page} basePath={`/dashboard/admin/orgs/${id}/datasets`} supportOrgId={id} canExport={false} />
    </div>
  );
}
