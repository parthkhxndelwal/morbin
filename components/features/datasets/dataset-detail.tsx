"use client";

import type { ColumnDef } from "@tanstack/react-table";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  EllipsisIcon,
  KeyRoundIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmAction } from "@/components/patterns/confirm-action";
import { DataTable } from "@/components/patterns/data-table";
import { FormDialog } from "@/components/patterns/form-dialog";
import { PromptAction } from "@/components/patterns/prompt-action";
import { EmptyState } from "@/components/patterns/states";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { DatasetColumn } from "@/lib/dataset-rules";
import type { DatasetRowView, DatasetSummary, RowsPage } from "@/lib/datasets";
import { deleteDatasetAction, deleteRowAction, renameDatasetAction, saveRowAction } from "./actions";
import { ImportDialog } from "./import-dialog";

const n = (v: number) => v.toLocaleString("en-IN");

/** Header actions for one dataset: import, add a row, export, rename, delete. */
export function DatasetActions({
  dataset,
  basePath,
  supportOrgId,
  canExport,
}: {
  dataset: DatasetSummary;
  basePath: string;
  supportOrgId: string | null;
  canExport: boolean;
}) {
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const hasColumns = dataset.columns.length > 0;
  return (
    <>
      <ImportDialog datasetId={dataset.id} supportOrgId={supportOrgId} hasColumns={hasColumns} />
      {hasColumns && <RowDialog dataset={dataset} supportOrgId={supportOrgId} row={null} />}
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label="More actions" />}>
          <EllipsisIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canExport && hasColumns && (
            <DropdownMenuItem render={<a href={`/api/export/dataset?id=${dataset.id}`} />}>
              <DownloadIcon />
              Export CSV
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => setRenaming(true)}>
            <PencilIcon />
            Rename
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => setDeleting(true)}>
            <Trash2Icon />
            Delete dataset
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <PromptAction
        open={renaming}
        onOpenChange={setRenaming}
        title="Rename dataset"
        label="Name"
        initialValue={dataset.name}
        minLength={2}
        confirmLabel="Rename"
        action={(name) => renameDatasetAction(supportOrgId, dataset.id, name)}
      />
      <ConfirmAction
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete “${dataset.name}”?`}
        description={`All ${n(dataset.rowCount)} rows are deleted. This can't be undone; export it first if you might need it.`}
        confirmLabel="Delete dataset"
        destructive
        action={() => deleteDatasetAction(supportOrgId, dataset.id)}
        onSuccess={() => router.push(basePath)}
      />
    </>
  );
}

/** Add (row null) or edit one row; one field per column. */
function RowDialog({
  dataset,
  supportOrgId,
  row,
  open,
  onOpenChange,
}: {
  dataset: DatasetSummary;
  supportOrgId: string | null;
  row: DatasetRowView | null;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <FormDialog
      trigger={
        row ? undefined : (
          <Button variant="outline">
            <PlusIcon data-icon="inline-start" />
            Add row
          </Button>
        )
      }
      open={open}
      onOpenChange={onOpenChange}
      title={row ? "Edit row" : "Add a row"}
      submitLabel={row ? "Save" : "Add row"}
      action={(fd) => saveRowAction(supportOrgId, dataset.id, row?.id ?? null, fd)}
    >
      {(errors) => (
        <FieldGroup>
          {dataset.columns.map((c) => (
            <ColumnField key={c.key} column={c} isKey={c.key === dataset.keyColumn} value={row?.values[c.key] ?? ""} error={errors[c.key]} />
          ))}
        </FieldGroup>
      )}
    </FormDialog>
  );
}

function ColumnField({ column, isKey, value, error }: { column: DatasetColumn; isKey: boolean; value: string; error?: string }) {
  const id = `row-${column.key}`;
  return (
    <Field data-invalid={!!error || undefined}>
      <FieldLabel htmlFor={id}>
        {column.label}
        {isKey && <KeyRoundIcon className="size-3.5 text-muted-foreground" aria-label="key" />}
      </FieldLabel>
      <Input
        id={id}
        name={`col:${column.key}`}
        defaultValue={value}
        type={column.type === "email" ? "email" : "text"}
        inputMode={column.type === "number" ? "decimal" : column.type === "email" ? "email" : undefined}
        required={isKey}
        maxLength={500}
        aria-invalid={!!error || undefined}
      />
      <FieldError>{error}</FieldError>
    </Field>
  );
}

function RowActions({ dataset, supportOrgId, row }: { dataset: DatasetSummary; supportOrgId: string | null; row: DatasetRowView }) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  return (
    <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Row actions" />}>
          <EllipsisIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setEditing(true)}>
            <PencilIcon />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => setDeleting(true)}>
            <Trash2Icon />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {editing && <RowDialog dataset={dataset} supportOrgId={supportOrgId} row={row} open={editing} onOpenChange={setEditing} />}
      <ConfirmAction
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete this row?"
        description="It stops matching booking questions straight away."
        confirmLabel="Delete row"
        destructive
        action={() => deleteRowAction(supportOrgId, dataset.id, row.id)}
      />
    </div>
  );
}

/**
 * One page of rows. Search and paging are server-side (the URL's `q` and
 * `page`): a dataset can hold 2,00,000 rows, so the browser only ever gets 50.
 */
export function DatasetRows({
  dataset,
  page,
  supportOrgId,
  basePath,
}: {
  dataset: DatasetSummary;
  page: RowsPage;
  supportOrgId: string | null;
  basePath: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState(page.query);
  const keyLabel = dataset.columns.find((c) => c.key === dataset.keyColumn)?.label ?? "key";
  const href = (p: number, query = page.query) => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (p > 1) params.set("page", String(p));
    const s = params.toString();
    return `${basePath}/${dataset.id}${s ? `?${s}` : ""}`;
  };

  if (dataset.columns.length === 0) {
    return (
      <EmptyState
        title="No columns yet"
        description="Import a CSV to set up this dataset. You'll see a preview and choose the key column before anything is saved."
        action={<ImportDialog datasetId={dataset.id} supportOrgId={supportOrgId} hasColumns={false} />}
      />
    );
  }

  const columns: ColumnDef<DatasetRowView, unknown>[] = [
    ...dataset.columns.map(
      (c): ColumnDef<DatasetRowView, unknown> => ({
        id: c.key,
        header: c.label,
        accessorFn: (r) => r.values[c.key] ?? "",
        enableHiding: c.key !== dataset.keyColumn,
        cell: ({ getValue }) => (
          <span className={`block max-w-64 truncate ${c.key === dataset.keyColumn ? "font-medium" : ""}`}>
            {String(getValue() ?? "")}
          </span>
        ),
      }),
    ),
    {
      id: "actions",
      header: "",
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => <RowActions dataset={dataset} supportOrgId={supportOrgId} row={row.original} />,
    },
  ];

  const from = page.total === 0 ? 0 : (page.page - 1) * page.pageSize + 1;
  const to = Math.min(page.page * page.pageSize, page.total);

  return (
    <div className="space-y-3">
      <form
        role="search"
        className="flex max-w-md gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          router.push(href(1, q.trim()));
        }}
      >
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
          placeholder={`Find by ${keyLabel}…`}
          aria-label={`Find by ${keyLabel}`}
        />
        <Button type="submit" variant="outline">
          <SearchIcon data-icon="inline-start" />
          Find
        </Button>
      </form>
      <DataTable
        key={`${page.query}:${page.page}`}
        columns={columns}
        data={page.rows}
        searchPlaceholder={null}
        pageSize={page.pageSize}
        emptyTitle={page.query ? `Nothing starts with “${page.query}”` : "No rows yet"}
        emptyDescription={page.query ? "Search matches the start of the key, ignoring case and spaces." : "Import a CSV or add rows one at a time."}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>
          {page.total === 0 ? "0 rows" : `${n(from)}–${n(to)} of ${n(page.total)} row${page.total === 1 ? "" : "s"}`}
          {page.query ? ` matching “${page.query}”` : ""}
        </span>
        {page.pageCount > 1 && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              disabled={page.page <= 1}
              render={<Link href={href(page.page - 1)} aria-disabled={page.page <= 1} />}
            >
              <ChevronLeftIcon data-icon="inline-start" />
              Previous
            </Button>
            <span className="tabular-nums">
              Page {n(page.page)} of {n(page.pageCount)}
            </span>
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              disabled={page.page >= page.pageCount}
              render={<Link href={href(page.page + 1)} aria-disabled={page.page >= page.pageCount} />}
            >
              Next
              <ChevronRightIcon data-icon="inline-end" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
