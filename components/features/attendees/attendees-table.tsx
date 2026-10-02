"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/patterns/data-table";
import { DateTime } from "@/components/patterns/money";
import { StatusBadge } from "@/components/patterns/status-badge";
import type { AttendeeRow } from "@/lib/dashboard-data";
import { STATUS } from "@/lib/status";
import { checkInAction } from "./actions";

function CheckInButton({ row, eventId }: { row: AttendeeRow; eventId: string }) {
  if (row.status !== "VALID") return null;
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={async () => {
        const r = await checkInAction(row.code, eventId);
        if (!r.ok) toast.error(r.error);
        else if (r.data.ok) toast.success(`${r.data.attendeeName} checked in`);
        else toast.error(r.data.message);
      }}
    >
      Check in
    </Button>
  );
}

export function AttendeesTable({
  eventId,
  rows,
  canCheckIn,
  exportHref,
}: {
  eventId: string;
  rows: AttendeeRow[];
  canCheckIn: boolean;
  exportHref?: string;
}) {
  const columns: ColumnDef<AttendeeRow, unknown>[] = [
    {
      id: "attendee",
      header: "Attendee",
      enableHiding: false,
      accessorFn: (r) => `${r.name} ${r.email} ${r.code}`,
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.original.name}</p>
          <p className="truncate text-xs text-muted-foreground">{row.original.email}</p>
        </div>
      ),
    },
    {
      accessorKey: "code",
      header: "Code",
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span>,
    },
    { accessorKey: "ticketType", header: "Ticket", filterFn: "equalsString" },
    {
      accessorKey: "status",
      header: "Status",
      filterFn: "equalsString",
      cell: ({ row }) => <StatusBadge kind="ticket" value={row.original.status} />,
    },
    {
      accessorKey: "checkedInAt",
      header: "Checked in",
      cell: ({ row }) =>
        row.original.checkedInAt ? (
          <DateTime value={row.original.checkedInAt} mode="relative" />
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    { accessorKey: "audience", header: "Audience", cell: ({ row }) => row.original.audience ?? "—" },
  ];
  if (canCheckIn) {
    columns.push({
      id: "actions",
      header: "",
      enableHiding: false,
      cell: ({ row }) => <CheckInButton row={row.original} eventId={eventId} />,
    });
  }
  const types = [...new Set(rows.map((r) => r.ticketType))];

  return (
    <DataTable
      columns={columns}
      data={rows}
      searchPlaceholder="Search name, email or code…"
      filters={[
        {
          columnId: "status",
          label: "Status",
          options: Object.entries(STATUS.ticket)
            .filter(([v]) => v !== "VOID")
            .map(([value, m]) => ({ value, label: m.label })),
        },
        ...(types.length > 1
          ? [{ columnId: "ticketType", label: "Ticket", options: types.map((t) => ({ value: t, label: t })) }]
          : []),
      ]}
      exportHref={
        exportHref
          ? (view) => {
              const q = new URLSearchParams({ eventId });
              if (view.search) q.set("q", view.search);
              if (view.filters.status) q.set("status", view.filters.status);
              return `${exportHref}?${q.toString()}`;
            }
          : undefined
      }
      emptyTitle="No attendees yet"
      emptyDescription="Tickets appear here as soon as they're issued."
      initialHidden={{ audience: false }}
    />
  );
}
