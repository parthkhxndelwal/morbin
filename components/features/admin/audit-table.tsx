"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { RotateCwIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmAction } from "@/components/patterns/confirm-action";
import { DataTable } from "@/components/patterns/data-table";
import { DateTime } from "@/components/patterns/money";
import type { AuditRow, FailedEmailRow } from "@/lib/admin-desk";
import { retryEmailAction } from "./actions";

/** "organization.fee.changed" → "Organization fee changed". */
function describe(action: string): string {
  const words = action.replace(/[._]/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const AREAS = ["organization", "payout", "refund", "team", "application", "event", "payoutAccount", "account"];

export function AuditTable({ rows }: { rows: AuditRow[] }) {
  const columns: ColumnDef<AuditRow, unknown>[] = [
    {
      accessorKey: "at",
      header: "When",
      sortingFn: "datetime",
      cell: ({ row }) => <DateTime value={row.original.at} />,
    },
    {
      id: "action",
      header: "What",
      enableHiding: false,
      accessorFn: (r) => `${r.action} ${r.actor} ${r.organizationName ?? ""} ${r.meta}`,
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="font-medium">{describe(row.original.action)}</p>
          {row.original.meta && <p className="max-w-md truncate font-mono text-xs text-muted-foreground">{row.original.meta}</p>}
        </div>
      ),
    },
    {
      id: "area",
      header: "Area",
      accessorFn: (r) => r.action.split(".")[0],
      filterFn: "equalsString",
    },
    {
      id: "actor",
      header: "Who",
      accessorFn: (r) => r.actor,
      cell: ({ row }) => (
        <div>
          <p>{row.original.actor}</p>
          <p className="text-xs text-muted-foreground">{row.original.actorRole.toLowerCase()}</p>
        </div>
      ),
    },
    {
      id: "org",
      header: "Organisation",
      accessorFn: (r) => r.organizationName ?? "",
      cell: ({ row }) =>
        row.original.organizationId && row.original.organizationName !== "deleted organisation" ? (
          <Link href={`/dashboard/admin/orgs/${row.original.organizationId}`} className="underline-offset-4 hover:underline">
            {row.original.organizationName}
          </Link>
        ) : (
          (row.original.organizationName ?? "—")
        ),
    },
  ];
  return (
    <DataTable
      columns={columns}
      data={rows}
      searchPlaceholder="Search action, person or organisation…"
      filters={[{ columnId: "area", label: "Area", options: AREAS.map((a) => ({ value: a, label: describe(a) })) }]}
      emptyTitle="Nothing recorded yet"
      initialSorting={[{ id: "at", desc: true }]}
      initialHidden={{ area: false }}
      pageSize={50}
    />
  );
}

export function FailedEmails({ rows }: { rows: FailedEmailRow[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead>Email</TableHead>
            <TableHead>To</TableHead>
            <TableHead className="hidden md:table-cell">Last error</TableHead>
            <TableHead className="w-0" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell>{describe(r.kind.toLowerCase())}</TableCell>
              <TableCell>{r.recipient}</TableCell>
              <TableCell className="hidden max-w-xs truncate text-muted-foreground md:table-cell">{r.lastError ?? "—"}</TableCell>
              <TableCell>
                <ConfirmAction
                  trigger={
                    <Button variant="ghost" size="sm">
                      <RotateCwIcon data-icon="inline-start" />
                      Retry
                    </Button>
                  }
                  title="Send this email again?"
                  description={`It gets a fresh set of ${r.attempts ? "attempts" : "tries"}; check SES is healthy first.`}
                  confirmLabel="Retry"
                  action={() => retryEmailAction(r.id)}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
