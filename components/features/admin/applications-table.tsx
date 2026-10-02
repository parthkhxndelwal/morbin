"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { CheckIcon, MessageSquareIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ConfirmAction } from "@/components/patterns/confirm-action";
import { DataTable } from "@/components/patterns/data-table";
import { DateTime } from "@/components/patterns/money";
import { PromptAction } from "@/components/patterns/prompt-action";
import { StatusBadge } from "@/components/patterns/status-badge";
import type { ApplicationRow } from "@/lib/applications";
import { STATUS } from "@/lib/status";
import { approveApplicationAction, rejectApplicationAction, requestApplicationInfoAction } from "./actions";

const TYPE_LABEL: Record<string, string> = { EVENT: "Event organiser", INSTITUTION: "College / university", CORPORATE: "Company" };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right break-words">{children}</span>
    </div>
  );
}

function ApplicationSheet({ app, onClose }: { app: ApplicationRow | null; onClose: () => void }) {
  const open = app && (app.status === "NEW" || app.status === "INFO_REQUESTED");
  return (
    <Sheet open={!!app} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        {app && (
          <>
            <SheetHeader>
              <SheetTitle>{app.organizationName}</SheetTitle>
              <SheetDescription>
                {TYPE_LABEL[app.type] ?? app.type} · {app.city}
              </SheetDescription>
            </SheetHeader>
            <div className="space-y-4 px-4">
              <div className="space-y-2">
                <Row label="Status">
                  <StatusBadge kind="application" value={app.status} />
                </Row>
                <Row label="Contact">
                  <span className="block">{app.contactName}</span>
                  <span className="block text-xs text-muted-foreground">{app.email}</span>
                  <span className="block text-xs text-muted-foreground">{app.phone}</span>
                </Row>
                <Row label="Events a year">{app.eventsPerYear}</Row>
                <Row label="Tickets per event">{app.ticketsPerEvent}</Row>
                <Row label="GSTIN">{app.gstin ?? "Not registered"}</Row>
                <Row label="Applied">
                  <DateTime value={app.createdAt} />
                </Row>
              </div>
              <Separator />
              <div className="space-y-1 text-sm">
                <p className="font-medium">About their events</p>
                <p className="whitespace-pre-wrap text-muted-foreground">{app.about}</p>
              </div>
              {app.decisionNote && (
                <>
                  <Separator />
                  <div className="space-y-1 text-sm">
                    <p className="font-medium">{app.status === "INFO_REQUESTED" ? "We asked" : "Our note"}</p>
                    <p className="whitespace-pre-wrap text-muted-foreground">{app.decisionNote}</p>
                  </div>
                </>
              )}
              {app.organizationId && (
                <Button variant="outline" className="w-full" nativeButton={false} render={<Link href={`/dashboard/admin/orgs/${app.organizationId}`} />}>
                  Open the organisation
                </Button>
              )}
            </div>
            {open && (
              <SheetFooter className="flex-row flex-wrap justify-end gap-2">
                <PromptAction
                  trigger={
                    <Button variant="ghost">
                      <XIcon data-icon="inline-start" />
                      Reject
                    </Button>
                  }
                  title="Reject this application?"
                  description="The applicant gets an email with your reason."
                  label="Reason"
                  multiline
                  minLength={5}
                  confirmLabel="Reject"
                  destructive
                  action={(reason) => rejectApplicationAction(app.id, reason)}
                  onSuccess={onClose}
                />
                <PromptAction
                  trigger={
                    <Button variant="outline">
                      <MessageSquareIcon data-icon="inline-start" />
                      Ask a question
                    </Button>
                  }
                  title="Ask the applicant"
                  description="Sent by email; they reply to it directly."
                  label="Your question"
                  multiline
                  minLength={5}
                  confirmLabel="Send"
                  action={(message) => requestApplicationInfoAction(app.id, message)}
                  onSuccess={onClose}
                />
                <ConfirmAction
                  trigger={
                    <Button>
                      <CheckIcon data-icon="inline-start" />
                      Approve
                    </Button>
                  }
                  title={`Approve ${app.organizationName}?`}
                  description={`Creates the organisation with ${app.email} as owner and emails them a link to set their password. Payments stay off until you verify the organisation.`}
                  confirmLabel="Approve"
                  action={() => approveApplicationAction(app.id)}
                  onSuccess={onClose}
                />
              </SheetFooter>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

export function ApplicationsTable({ rows }: { rows: ApplicationRow[] }) {
  const [open, setOpen] = useState<ApplicationRow | null>(null);
  const columns: ColumnDef<ApplicationRow, unknown>[] = [
    {
      id: "org",
      header: "Applicant",
      enableHiding: false,
      accessorFn: (r) => `${r.organizationName} ${r.contactName} ${r.email} ${r.city}`,
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.original.organizationName}</p>
          <p className="truncate text-xs text-muted-foreground">
            {row.original.contactName} · {row.original.city}
          </p>
        </div>
      ),
    },
    { accessorKey: "type", header: "Type", filterFn: "equalsString", cell: ({ row }) => TYPE_LABEL[row.original.type] ?? row.original.type },
    { accessorKey: "ticketsPerEvent", header: "Tickets / event" },
    {
      accessorKey: "status",
      header: "Status",
      filterFn: "equalsString",
      cell: ({ row }) => <StatusBadge kind="application" value={row.original.status} />,
    },
    {
      accessorKey: "createdAt",
      header: "Applied",
      sortingFn: "datetime",
      cell: ({ row }) => <DateTime value={row.original.createdAt} mode="relative" />,
    },
  ];
  return (
    <>
      <DataTable
        columns={columns}
        data={rows}
        onRowClick={setOpen}
        searchPlaceholder="Search applicant, email or city…"
        filters={[
          { columnId: "status", label: "Status", options: Object.entries(STATUS.application).map(([value, m]) => ({ value, label: m.label })) },
          { columnId: "type", label: "Type", options: Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label })) },
        ]}
        emptyTitle="No applications yet"
        emptyDescription="Organisations apply at /apply. New ones appear here and in your notifications."
        initialSorting={[{ id: "createdAt", desc: true }]}
      />
      <ApplicationSheet app={open} onClose={() => setOpen(null)} />
    </>
  );
}
