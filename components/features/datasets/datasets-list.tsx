"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { PlusIcon } from "lucide-react";
import { DataTable } from "@/components/patterns/data-table";
import { FormDialog } from "@/components/patterns/form-dialog";
import { DateTime } from "@/components/patterns/money";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { DatasetSummary } from "@/lib/datasets";
import { createDatasetAction } from "./actions";

const columns: ColumnDef<DatasetSummary, unknown>[] = [
  {
    accessorKey: "name",
    header: "Dataset",
    enableHiding: false,
    cell: ({ row }) => (
      <div className="min-w-0">
        <p className="truncate font-medium">{row.original.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {row.original.columns.length === 0
            ? "No columns yet — import a CSV"
            : row.original.columns.map((c) => c.label).join(" · ")}
        </p>
      </div>
    ),
  },
  {
    accessorKey: "rowCount",
    header: "Rows",
    cell: ({ row }) => <span className="tabular-nums">{row.original.rowCount.toLocaleString("en-IN")}</span>,
  },
  {
    accessorKey: "updatedAt",
    header: "Updated",
    sortingFn: "datetime",
    cell: ({ row }) => <DateTime value={row.original.updatedAt} mode="relative" />,
  },
];

/** "New dataset": name only; the first CSV import sets up the columns. */
export function NewDatasetButton({ supportOrgId, basePath }: { supportOrgId: string | null; basePath: string }) {
  return (
    <FormDialog
      trigger={
        <Button>
          <PlusIcon data-icon="inline-start" />
          New dataset
        </Button>
      }
      title="New dataset"
      description="Give it a name, then import a CSV to set up its columns and rows."
      submitLabel="Create"
      action={(fd) => createDatasetAction(supportOrgId, fd)}
      onSuccess={(data) => `${basePath}/${data.id}`}
    >
      {(errors) => (
        <Field data-invalid={!!errors.name || undefined}>
          <FieldLabel htmlFor="dataset-name">Name</FieldLabel>
          <Input id="dataset-name" name="name" placeholder="Students 2026–27" maxLength={80} required autoFocus />
          <FieldDescription>Only your organisation sees this.</FieldDescription>
          <FieldError>{errors.name}</FieldError>
        </Field>
      )}
    </FormDialog>
  );
}

/** The organisation's datasets. Shared by the owner page and Admin → Organisations → Datasets. */
export function DatasetsList({
  datasets,
  basePath,
  supportOrgId,
}: {
  datasets: DatasetSummary[];
  basePath: string;
  supportOrgId: string | null;
}) {
  return (
    <DataTable
      columns={columns}
      data={datasets}
      searchPlaceholder={datasets.length > 8 ? "Search datasets…" : null}
      rowHref={(d) => `${basePath}/${d.id}`}
      emptyTitle="No datasets yet"
      emptyDescription="Upload a list such as roll numbers with names and emails. Booking questions can then check answers against it."
      emptyAction={<NewDatasetButton supportOrgId={supportOrgId} basePath={basePath} />}
      initialSorting={[{ id: "name", desc: false }]}
    />
  );
}
