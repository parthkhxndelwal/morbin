"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, type DataTableFilter } from "@/components/patterns/data-table";
import { DateTime, Money } from "@/components/patterns/money";
import { StatusBadge } from "@/components/patterns/status-badge";
import { STATUS } from "@/lib/status";
import type { OrderRow } from "@/lib/dashboard-data";

function columns(showEvent: boolean): ColumnDef<OrderRow, unknown>[] {
  const cols: ColumnDef<OrderRow, unknown>[] = [
    {
      id: "buyer",
      header: "Buyer",
      enableHiding: false,
      accessorFn: (r) => `${r.buyerName} ${r.buyerEmail}`,
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.original.buyerName}</p>
          <p className="truncate text-xs text-muted-foreground">{row.original.buyerEmail}</p>
        </div>
      ),
    },
  ];
  if (showEvent) {
    cols.push({ accessorKey: "eventTitle", header: "Event", filterFn: "equalsString" });
  }
  cols.push(
    { accessorKey: "tickets", header: "Tickets", cell: ({ row }) => <span className="tabular-nums">{row.original.tickets}</span> },
    { accessorKey: "amountPaise", header: "Amount", cell: ({ row }) => <Money paise={row.original.amountPaise} /> },
    {
      accessorKey: "status",
      header: "Status",
      filterFn: "equalsString",
      cell: ({ row }) => <StatusBadge kind="order" value={row.original.status} />,
    },
    {
      accessorKey: "audience",
      header: "Audience",
      cell: ({ row }) => row.original.audience ?? <span className="text-muted-foreground">—</span>,
    },
    {
      accessorKey: "createdAt",
      header: "Placed",
      sortingFn: "datetime",
      cell: ({ row }) => <DateTime value={row.original.createdAt} />,
    },
  );
  return cols;
}

/** Orders for one event or the whole organisation. */
export function OrdersTable({
  rows,
  showEvent = true,
  compact = false,
}: {
  rows: OrderRow[];
  showEvent?: boolean;
  /** Recent-orders mode: no search/filters, small page. */
  compact?: boolean;
}) {
  const filters: DataTableFilter[] = compact
    ? []
    : [
        {
          columnId: "status",
          label: "Status",
          options: Object.entries(STATUS.order).map(([value, m]) => ({ value, label: m.label })),
        },
        ...(showEvent
          ? [
              {
                columnId: "eventTitle",
                label: "Event",
                options: [...new Set(rows.map((r) => r.eventTitle))].map((t) => ({ value: t, label: t })),
              },
            ]
          : []),
      ];
  return (
    <DataTable
      columns={columns(showEvent)}
      data={rows}
      searchPlaceholder={compact ? null : "Search buyer name or email…"}
      filters={filters}
      pageSize={compact ? 8 : 25}
      emptyTitle="No orders yet"
      emptyDescription="Orders appear here as soon as someone books."
      initialSorting={[{ id: "createdAt", desc: true }]}
      initialHidden={{ audience: false }}
    />
  );
}
