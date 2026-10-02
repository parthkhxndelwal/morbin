import { notFound } from "next/navigation";
import { DatasetsList, NewDatasetButton } from "@/components/features/datasets/datasets-list";
import { PageHeader } from "@/components/patterns/page-header";
import { listDatasets } from "@/lib/datasets";
import { MAX_DATASETS_PER_ORG } from "@/lib/dataset-rules";
import { requireOrgSession } from "@/lib/guards";
import { can } from "@/lib/permissions";

export const metadata = { title: "Datasets" };

/**
 * The organisation's reusable lists (roll numbers, staff). Owner only:
 * members never see them, since rows are personal data.
 */
export default async function DatasetsPage() {
  const { org, role } = await requireOrgSession();
  if (!can(role, "manageDatasets")) notFound();
  const datasets = await listDatasets(org._id.toString());
  return (
    <div className="space-y-6">
      <PageHeader
        title="Datasets"
        description="Lists such as roll numbers or staff IDs that booking questions can check answers against. Bookings never change them."
        actions={datasets.length < MAX_DATASETS_PER_ORG ? <NewDatasetButton supportOrgId={null} basePath="/dashboard/datasets" /> : undefined}
      />
      <DatasetsList datasets={datasets} basePath="/dashboard/datasets" supportOrgId={null} />
    </div>
  );
}
