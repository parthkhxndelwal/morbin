"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/patterns/data-table";
import { DateTime, Money } from "@/components/patterns/money";
import { StatusBadge } from "@/components/patterns/status-badge";
import type { PayoutRow } from "@/lib/dashboard-data";
import { STATUS } from "@/lib/status";

/** Payouts list. `basePath` decides where a row opens (owner vs admin desk). */
export function PayoutsTable({
  rows,
  basePath,
  showOrganisation = false,
}: {
  rows: PayoutRow[];
  basePath: string;
  showOrganisation?: boolean;
}) {
  const columns: ColumnDef<PayoutRow, unknown>[] = [
    {
      id: "payout",
      header: showOrganisation ? "Organisation" : "Payout",
      enableHiding: false,
      accessorFn: (r) => `${r.organizationName ?? ""} ${r.bankReference ?? ""}`,
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="truncate font-medium">
            {showOrganisation ? (row.original.organizationName ?? "—") : <DateTime value={row.original.createdAt} mode="date" />}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {row.original.bankReference ? `UTR ${row.original.bankReference}` : `${row.original.entryCount} ledger entries`}
          </p>
        </div>
      ),
    },
    { accessorKey: "netPaise", header: "Net amount", cell: ({ row }) => <Money paise={row.original.netPaise} /> },
    {
      accessorKey: "cutoffAt",
      header: "Covers up to",
      sortingFn: "datetime",
      cell: ({ row }) => <DateTime value={row.original.cutoffAt} />,
    },
    {
      accessorKey: "transferredAt",
      header: "Transferred",
      cell: ({ row }) => <DateTime value={row.original.transferredAt} mode="date" />,
    },
    {
      accessorKey: "status",
      header: "Status",
      filterFn: "equalsString",
      cell: ({ row }) => <StatusBadge kind="payout" value={row.original.status} />,
    },
  ];
  return (
    <DataTable
      columns={columns}
      data={rows}
      rowHref={(r) => `${basePath}/${r.id}`}
      searchPlaceholder={showOrganisation ? "Search organisation or UTR…" : "Search UTR…"}
      filters={[
        {
          columnId: "status",
          label: "Status",
          options: Object.entries(STATUS.payout).map(([value, m]) => ({ value, label: m.label })),
        },
      ]}
      emptyTitle="No payouts yet"
      emptyDescription={
        showOrganisation
          ? "Issue a payout from an organisation's balance."
          : "When Morbin transfers your earnings, the payout and its statement appear here."
      }
      initialSorting={[{ id: "cutoffAt", desc: true }]}
    />
  );
}
