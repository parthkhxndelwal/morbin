import { BreadcrumbLabel } from "@/components/breadcrumb-labels";
import { PageHeader } from "@/components/patterns/page-header";
import type { DatasetSummary, RowsPage } from "@/lib/datasets";
import { DatasetActions, DatasetRows } from "./dataset-detail";

/** One dataset's page body, shared by the owner route and the admin support route. */
export function DatasetView({
  dataset,
  page,
  basePath,
  supportOrgId,
  canExport,
}: {
  dataset: DatasetSummary;
  page: RowsPage;
  basePath: string;
  supportOrgId: string | null;
  canExport: boolean;
}) {
  const key = dataset.columns.find((c) => c.key === dataset.keyColumn);
  return (
    <div className="space-y-6">
      <BreadcrumbLabel segment={dataset.id} label={dataset.name} />
      <PageHeader
        title={dataset.name}
        description={
          key
            ? `${dataset.rowCount.toLocaleString("en-IN")} rows · identified by ${key.label} (case and spaces ignored)`
            : "Import a CSV to set up columns."
        }
        actions={<DatasetActions dataset={dataset} basePath={basePath} supportOrgId={supportOrgId} canExport={canExport} />}
      />
      <DatasetRows dataset={dataset} page={page} supportOrgId={supportOrgId} basePath={basePath} />
    </div>
  );
}
