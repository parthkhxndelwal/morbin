import { notFound } from "next/navigation";
import { BreadcrumbLabel } from "@/components/breadcrumb-labels";
import { DatasetsList, NewDatasetButton } from "@/components/features/datasets/datasets-list";
import { DatasetSupportBanner } from "@/components/features/datasets/support-banner";
import { PageHeader } from "@/components/patterns/page-header";
import { requireAdmin } from "@/lib/admin";
import { getDb, toObjectId } from "@/lib/db";
import { listDatasets } from "@/lib/datasets";
import type { Organization } from "@/lib/types";

export const metadata = { title: "Datasets" };

/** An organisation's datasets, opened by a Morbin admin as support. */
export default async function AdminOrgDatasetsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const _id = toObjectId(id);
  const org = _id ? await (await getDb()).collection<Organization>("organizations").findOne({ _id }, { projection: { name: 1 } }) : null;
  if (!org) notFound();
  const basePath = `/dashboard/admin/orgs/${id}/datasets`;
  return (
    <div className="space-y-6">
      <BreadcrumbLabel segment={id} label={org.name} />
      <DatasetSupportBanner orgId={id} orgName={org.name} />
      <PageHeader
        title="Datasets"
        description={`${org.name}'s lists. Import or edit rows on their behalf, e.g. a student list they emailed in.`}
        actions={<NewDatasetButton supportOrgId={id} basePath={basePath} />}
      />
      <DatasetsList datasets={await listDatasets(id)} basePath={basePath} supportOrgId={id} />
    </div>
  );
}
