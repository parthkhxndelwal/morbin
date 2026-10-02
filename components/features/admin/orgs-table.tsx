"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { DataTable } from "@/components/patterns/data-table";
import { FormDialog } from "@/components/patterns/form-dialog";
import { DateTime } from "@/components/patterns/money";
import { StatusBadge } from "@/components/patterns/status-badge";
import { STATUS } from "@/lib/status";
import { createOrganizationAction } from "./actions";

export interface OrgListRow {
  id: string;
  name: string;
  type: string;
  status: string;
  paymentAccountStatus: string;
  ownerEmail: string | null;
  events: number;
  orders: number;
  createdAt: string;
}

const TYPE_LABEL: Record<string, string> = { EVENT: "Event organiser", INSTITUTION: "Institution", CORPORATE: "Company" };

export function NewOrganizationButton() {
  return (
    <FormDialog
      trigger={
        <Button>
          <PlusIcon data-icon="inline-start" />
          New organisation
        </Button>
      }
      title="New organisation"
      description="The owner gets an email to choose their password. You never set it for them."
      submitLabel="Create"
      action={createOrganizationAction}
      onSuccess={(d) => `/dashboard/admin/orgs/${d.id}`}
    >
      {(errors) => (
        <FieldGroup>
          <Field data-invalid={!!errors.name || undefined}>
            <FieldLabel htmlFor="org-name">Organisation name</FieldLabel>
            <Input id="org-name" name="name" required aria-invalid={!!errors.name || undefined} />
            <FieldError>{errors.name}</FieldError>
          </Field>
          <Field data-invalid={!!errors.type || undefined}>
            <FieldLabel htmlFor="org-type">Type</FieldLabel>
            <NativeSelect id="org-type" name="type" defaultValue="EVENT" className="w-full">
              {Object.entries(TYPE_LABEL).map(([v, l]) => (
                <NativeSelectOption key={v} value={v}>
                  {l}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <FieldDescription>Institutions call their members “Students”; others “Staff”.</FieldDescription>
            <FieldError>{errors.type}</FieldError>
          </Field>
          <Field data-invalid={!!errors.ownerEmail || undefined}>
            <FieldLabel htmlFor="org-owner-email">Owner&apos;s email</FieldLabel>
            <Input id="org-owner-email" name="ownerEmail" type="email" required aria-invalid={!!errors.ownerEmail || undefined} />
            <FieldError>{errors.ownerEmail}</FieldError>
          </Field>
          <Field data-invalid={!!errors.ownerName || undefined}>
            <FieldLabel htmlFor="org-owner-name">Owner&apos;s name (optional)</FieldLabel>
            <Input id="org-owner-name" name="ownerName" />
            <FieldError>{errors.ownerName}</FieldError>
          </Field>
        </FieldGroup>
      )}
    </FormDialog>
  );
}

export function OrgsTable({ rows }: { rows: OrgListRow[] }) {
  const columns: ColumnDef<OrgListRow, unknown>[] = [
    {
      id: "org",
      header: "Organisation",
      enableHiding: false,
      accessorFn: (r) => `${r.name} ${r.ownerEmail ?? ""}`,
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.original.name}</p>
          <p className="truncate text-xs text-muted-foreground">{row.original.ownerEmail ?? "No owner"}</p>
        </div>
      ),
    },
    { accessorKey: "type", header: "Type", filterFn: "equalsString", cell: ({ row }) => TYPE_LABEL[row.original.type] ?? row.original.type },
    { accessorKey: "events", header: "Events" },
    { accessorKey: "orders", header: "Orders" },
    {
      accessorKey: "paymentAccountStatus",
      header: "Payments",
      filterFn: "equalsString",
      cell: ({ row }) => <StatusBadge kind="paymentAccount" value={row.original.paymentAccountStatus} />,
    },
    {
      accessorKey: "status",
      header: "Status",
      filterFn: "equalsString",
      cell: ({ row }) => <StatusBadge kind="organization" value={row.original.status} />,
    },
    {
      accessorKey: "createdAt",
      header: "Joined",
      sortingFn: "datetime",
      cell: ({ row }) => <DateTime value={row.original.createdAt} mode="date" />,
    },
  ];
  return (
    <DataTable
      columns={columns}
      data={rows}
      rowHref={(r) => `/dashboard/admin/orgs/${r.id}`}
      searchPlaceholder="Search organisation or owner…"
      filters={[
        { columnId: "status", label: "Status", options: Object.entries(STATUS.organization).map(([value, m]) => ({ value, label: m.label })) },
        {
          columnId: "paymentAccountStatus",
          label: "Payments",
          options: Object.entries(STATUS.paymentAccount).map(([value, m]) => ({ value, label: m.label })),
        },
        { columnId: "type", label: "Type", options: Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label })) },
      ]}
      emptyTitle="No organisations yet"
      emptyDescription="Create one, or approve an application."
      initialSorting={[{ id: "createdAt", desc: true }]}
    />
  );
}
