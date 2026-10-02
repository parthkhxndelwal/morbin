"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { CheckIcon, DownloadIcon, EraserIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DataTable } from "@/components/patterns/data-table";
import { DateTime } from "@/components/patterns/money";
import { PromptAction } from "@/components/patterns/prompt-action";
import { StatusBadge } from "@/components/patterns/status-badge";
import type { DataRequestRow } from "@/lib/privacy";
import { STATUS } from "@/lib/status";
import {
  completeDataRequestAction,
  fulfilAccessAction,
  fulfilErasureAction,
  rejectDataRequestAction,
} from "./privacy-actions";

const TYPE_LABEL: Record<string, string> = { ACCESS: "Access", CORRECTION: "Correction", ERASURE: "Erasure" };

/** Days left on the statutory clock: red within a week, and once overdue. */
export function DeadlineBadge({ daysLeft }: { daysLeft: number | null }) {
  if (daysLeft === null) return <span className="text-muted-foreground">—</span>;
  if (daysLeft < 0) return <Badge variant="destructive">{-daysLeft}d overdue</Badge>;
  return <Badge variant={daysLeft <= 7 ? "destructive" : "secondary"} className="tabular-nums">{daysLeft}d left</Badge>;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right break-words">{children}</span>
    </div>
  );
}

function RequestSheet({ req, onClose }: { req: DataRequestRow | null; onClose: () => void }) {
  return (
    <Sheet open={!!req} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        {req && (
          <>
            <SheetHeader>
              <SheetTitle>{TYPE_LABEL[req.type]} request</SheetTitle>
              <SheetDescription className="break-all">{req.email}</SheetDescription>
            </SheetHeader>
            <div className="space-y-4 px-4">
              <div className="space-y-2">
                <Row label="Status">
                  <StatusBadge kind="dataRequest" value={req.status} />
                </Row>
                {req.status === "OPEN" && (
                  <Row label="Deadline">
                    <DeadlineBadge daysLeft={req.daysLeft} /> {req.dueAt && <DateTime value={req.dueAt} mode="date" />}
                  </Row>
                )}
                <Row label="Confirmed">{req.verifiedAt ? <DateTime value={req.verifiedAt} /> : "—"}</Row>
                {req.handledAt && (
                  <Row label="Answered">
                    <DateTime value={req.handledAt} />
                  </Row>
                )}
                {req.type === "ACCESS" && req.status === "DONE" && (
                  <Row label="Export">
                    {req.downloadedAt ? (
                      <>Downloaded <DateTime value={req.downloadedAt} mode="relative" /></>
                    ) : req.downloadExpiresAt && new Date(req.downloadExpiresAt) > new Date() ? (
                      <>Not downloaded yet</>
                    ) : (
                      <>Link expired</>
                    )}
                  </Row>
                )}
              </div>
              {req.details && (
                <>
                  <Separator />
                  <div className="space-y-1 text-sm">
                    <p className="font-medium">They wrote</p>
                    <p className="whitespace-pre-wrap text-muted-foreground">{req.details}</p>
                  </div>
                </>
              )}
              {req.outcome && (
                <>
                  <Separator />
                  <div className="space-y-1 text-sm">
                    <p className="font-medium">Our answer</p>
                    <p className="whitespace-pre-wrap text-muted-foreground">{req.outcome}</p>
                  </div>
                </>
              )}
              {req.status === "OPEN" && req.type === "ERASURE" && (
                <p className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
                  Erasing replaces their name, email and phone on orders, tickets, checkout sessions, refunds and email
                  history, and removes their booking answers and ticket PDFs. Amounts, the ledger, payouts and tax invoices
                  are untouched — invoices keep the recipient for 8 years by law, and the email tells them so.
                </p>
              )}
            </div>
            {req.status === "OPEN" && (
              <SheetFooter className="flex-row flex-wrap justify-end gap-2">
                <PromptAction
                  trigger={
                    <Button variant="ghost">
                      <XIcon data-icon="inline-start" />
                      Decline
                    </Button>
                  }
                  title="Decline this request?"
                  description="The requester gets an email with your reason and how to escalate."
                  label="Reason"
                  multiline
                  minLength={5}
                  confirmLabel="Decline"
                  destructive
                  action={(reason) => rejectDataRequestAction(req.id, reason)}
                  onSuccess={onClose}
                />
                {req.type === "ACCESS" && (
                  <PromptAction
                    trigger={
                      <Button>
                        <DownloadIcon data-icon="inline-start" />
                        Send export
                      </Button>
                    }
                    title="Send their data export?"
                    description="Builds a JSON file of everything tied to this address and emails a one-time link that expires in 7 days."
                    label="Note to include (optional)"
                    multiline
                    required={false}
                    minLength={0}
                    confirmLabel="Send export"
                    action={(note) => fulfilAccessAction(req.id, note)}
                    onSuccess={onClose}
                  />
                )}
                {req.type === "ERASURE" && (
                  <PromptAction
                    trigger={
                      <Button variant="destructive">
                        <EraserIcon data-icon="inline-start" />
                        Erase
                      </Button>
                    }
                    title="Erase their personal data?"
                    description="This can't be undone. Tickets already issued stay valid by their code."
                    label="Note to include (optional)"
                    multiline
                    required={false}
                    minLength={0}
                    confirmLabel="Erase"
                    destructive
                    action={(note) => fulfilErasureAction(req.id, note)}
                    onSuccess={onClose}
                  />
                )}
                {req.type === "CORRECTION" && (
                  <PromptAction
                    trigger={
                      <Button>
                        <CheckIcon data-icon="inline-start" />
                        Mark corrected
                      </Button>
                    }
                    title="Mark as corrected"
                    description="Make the change first (for example in the order's support editor), then tell them what changed."
                    label="What was changed"
                    multiline
                    minLength={5}
                    confirmLabel="Send"
                    action={(outcome) => completeDataRequestAction(req.id, outcome)}
                    onSuccess={onClose}
                  />
                )}
              </SheetFooter>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

export function DataRequestsTable({ rows }: { rows: DataRequestRow[] }) {
  const [open, setOpen] = useState<DataRequestRow | null>(null);
  const columns: ColumnDef<DataRequestRow, unknown>[] = [
    {
      id: "email",
      header: "Requester",
      enableHiding: false,
      accessorFn: (r) => r.email,
      cell: ({ row }) => <span className="block max-w-56 truncate font-medium">{row.original.email}</span>,
    },
    { accessorKey: "type", header: "Type", filterFn: "equalsString", cell: ({ row }) => TYPE_LABEL[row.original.type] },
    {
      accessorKey: "status",
      header: "Status",
      filterFn: "equalsString",
      cell: ({ row }) => <StatusBadge kind="dataRequest" value={row.original.status} />,
    },
    {
      id: "deadline",
      header: "Deadline",
      accessorFn: (r) => r.daysLeft ?? Number.MAX_SAFE_INTEGER,
      cell: ({ row }) => <DeadlineBadge daysLeft={row.original.daysLeft} />,
    },
    {
      accessorKey: "verifiedAt",
      header: "Confirmed",
      sortingFn: "datetime",
      cell: ({ row }) => (row.original.verifiedAt ? <DateTime value={row.original.verifiedAt} mode="relative" /> : "—"),
    },
  ];
  return (
    <>
      <DataTable
        columns={columns}
        data={rows}
        onRowClick={setOpen}
        searchPlaceholder="Search email…"
        filters={[
          {
            columnId: "status",
            label: "Status",
            options: Object.entries(STATUS.dataRequest)
              .filter(([v]) => v !== "UNVERIFIED")
              .map(([value, m]) => ({ value, label: m.label })),
          },
          { columnId: "type", label: "Type", options: Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label })) },
        ]}
        emptyTitle="No data requests"
        emptyDescription="Confirmed requests from /privacy/request appear here, with their deadline."
        initialSorting={[{ id: "deadline", desc: false }]}
      />
      <RequestSheet req={open} onClose={() => setOpen(null)} />
    </>
  );
}
