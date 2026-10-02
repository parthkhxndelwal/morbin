"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/patterns/data-table";
import { DateTime, Money } from "@/components/patterns/money";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Progress } from "@/components/ui/progress";
import { STATUS } from "@/lib/status";

/** What the events table needs — plain, serialisable, no Mongo documents. */
export interface EventRow {
  id: string;
  title: string;
  venue: string;
  /** DRAFT | PUBLISHED | CANCELLED | ENDED (ENDED derived from endsAt) */
  status: string;
  startsAt: string;
  sold: number;
  capacity: number;
  grossPaise: number;
}

const columns: ColumnDef<EventRow, unknown>[] = [
  {
    accessorKey: "title",
    header: "Event",
    enableHiding: false,
    cell: ({ row }) => (
      <div className="min-w-0">
        <p className="truncate font-medium">{row.original.title}</p>
        <p className="truncate text-xs text-muted-foreground">{row.original.venue}</p>
      </div>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    filterFn: "equalsString",
    cell: ({ row }) => <StatusBadge kind="event" value={row.original.status} />,
  },
  {
    accessorKey: "startsAt",
    header: "Date",
    sortingFn: "datetime",
    cell: ({ row }) => <DateTime value={row.original.startsAt} />,
  },
  {
    id: "sales",
    header: "Tickets sold",
    accessorFn: (r) => r.sold,
    cell: ({ row }) => {
      const { sold, capacity } = row.original;
      if (capacity === 0) return <span className="text-muted-foreground">No tickets yet</span>;
      return (
        <div className="flex min-w-32 items-center gap-2">
          <Progress value={(sold / capacity) * 100} className="h-1.5" />
          <span className="text-xs tabular-nums text-muted-foreground">
            {sold}/{capacity}
          </span>
        </div>
      );
    },
  },
  {
    accessorKey: "grossPaise",
    header: "Gross sales",
    cell: ({ row }) => <Money paise={row.original.grossPaise} />,
  },
];

export function EventsTable({
  rows,
  emptyAction,
}: {
  rows: EventRow[];
  emptyAction?: React.ReactNode;
}) {
  return (
    <DataTable
      columns={columns}
      data={rows}
      searchPlaceholder="Search events…"
      filters={[
        {
          columnId: "status",
          label: "Status",
          options: Object.entries(STATUS.event).map(([value, m]) => ({ value, label: m.label })),
        },
      ]}
      rowHref={(r) => `/dashboard/events/${r.id}`}
      emptyTitle="No events yet"
      emptyDescription="Create your first event, add ticket types, and publish it when you're ready."
      emptyAction={emptyAction}
      initialSorting={[{ id: "startsAt", desc: true }]}
    />
  );
}
