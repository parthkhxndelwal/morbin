"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangleIcon, CheckIcon, MailIcon, RotateCwIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ConfirmAction } from "@/components/patterns/confirm-action";
import { DataTable } from "@/components/patterns/data-table";
import { DateTime, Money } from "@/components/patterns/money";
import { PromptAction } from "@/components/patterns/prompt-action";
import { StatusBadge } from "@/components/patterns/status-badge";
import type { RefundRow } from "@/lib/dashboard-data";
import { STATUS } from "@/lib/status";
import {
  approveRefundAction,
  completeManuallyAction,
  emailCustomerAction,
  markSettledAction,
  rejectRefundAction,
  retryRefundAction,
  withdrawRefundAction,
} from "./actions";

type Viewer = "OWNER" | "ADMIN";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

/** The actions available for a case, by who is looking and where it is. */
function CaseActions({ rc, viewer, balancePaise }: { rc: RefundRow; viewer: Viewer; balancePaise: number | null }) {
  const short = rc.settledBy === "MORBIN" && balancePaise !== null && rc.amountPaise > balancePaise;
  if (viewer === "OWNER") {
    if (rc.status === "REQUESTED") {
      return (
        <ConfirmAction
          trigger={
            <Button variant="outline">
              <XIcon data-icon="inline-start" />
              Withdraw request
            </Button>
          }
          title="Withdraw this refund request?"
          description="The held amount returns to your unpaid balance and the tickets stay valid."
          confirmLabel="Withdraw"
          action={() => withdrawRefundAction(rc.id)}
        />
      );
    }
    if (rc.status === "APPROVED" && rc.settledBy === "ORGANISATION") {
      return (
        <PromptAction
          trigger={
            <Button>
              <CheckIcon data-icon="inline-start" />
              Mark as refunded
            </Button>
          }
          title="Record your refund"
          description={`Confirm you've paid ${rc.customerName} back yourselves.`}
          label="Payment reference"
          placeholder="UTR, UPI reference or receipt number"
          confirmLabel="Mark refunded"
          action={(ref) => markSettledAction(rc.id, ref)}
        />
      );
    }
    return null;
  }

  if (rc.status === "REQUESTED") {
    return (
      <>
        <PromptAction
          trigger={
            <Button variant="outline">
              <XIcon data-icon="inline-start" />
              Reject
            </Button>
          }
          title="Reject this refund?"
          description="The hold is released and the tickets stay valid. The organisation sees your note."
          label="Reason"
          multiline
          minLength={5}
          confirmLabel="Reject"
          destructive
          action={(note) => rejectRefundAction(rc.id, note)}
        />
        <PromptAction
          trigger={
            <Button>
              <CheckIcon data-icon="inline-start" />
              Approve
            </Button>
          }
          title="Approve this refund?"
          description={
            <>
              {rc.settledBy === "MORBIN"
                ? "The tickets are voided and the refund is sent to Razorpay straight away."
                : "The tickets are voided; the organisation pays the customer themselves."}
              {short && (
                <span className="mt-2 flex items-start gap-1.5 font-medium text-destructive">
                  <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
                  This is more than the Razorpay balance (<Money paise={balancePaise!} />), so Razorpay will likely
                  refuse it until more payments come in.
                </span>
              )}
            </>
          }
          label="Note (optional)"
          required={false}
          confirmLabel="Approve"
          action={(note) => approveRefundAction(rc.id, note)}
        />
      </>
    );
  }
  if (rc.status === "FAILED" || (rc.status === "APPROVED" && rc.settledBy === "MORBIN")) {
    return (
      <>
        <PromptAction
          trigger={<Button variant="outline">Paid manually</Button>}
          title="Record a manual refund"
          description="Use this only if you transferred the money yourself outside Razorpay."
          label="Bank transfer reference"
          confirmLabel="Mark refunded"
          action={(ref) => completeManuallyAction(rc.id, ref)}
        />
        <ConfirmAction
          trigger={
            <Button>
              <RotateCwIcon data-icon="inline-start" />
              Retry Razorpay
            </Button>
          }
          title="Send to Razorpay again?"
          description="Razorpay is checked first, so this can never refund twice."
          confirmLabel="Retry"
          action={() => retryRefundAction(rc.id)}
        />
      </>
    );
  }
  return null;
}

function CaseSheet({
  rc,
  viewer,
  balancePaise,
  onClose,
}: {
  rc: RefundRow | null;
  viewer: Viewer;
  balancePaise: number | null;
  onClose: () => void;
}) {
  return (
    <Sheet open={!!rc} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        {rc && (
          <>
            <SheetHeader>
              <SheetTitle>
                Refund of <Money paise={rc.amountPaise} />
              </SheetTitle>
              <SheetDescription>
                {rc.eventTitle}
                {rc.organizationName ? ` · ${rc.organizationName}` : ""}
              </SheetDescription>
            </SheetHeader>
            <div className="flex-1 space-y-4 px-4">
              {rc.failureReason && rc.status === "FAILED" && (
                <Alert variant="destructive">
                  <AlertDescription>{rc.failureReason}</AlertDescription>
                </Alert>
              )}
              <div className="space-y-2">
                <Row label="Status">
                  <StatusBadge kind="refund" value={rc.status} />
                </Row>
                <Row label="Customer">
                  <span className="block">{rc.customerName}</span>
                  <span className="block text-xs text-muted-foreground">{rc.customerEmail}</span>
                </Row>
                <Row label="Tickets">{rc.tickets}</Row>
                <Row label="Settled by">{rc.settledBy === "MORBIN" ? "Morbin, via Razorpay" : "The organisation"}</Row>
                {rc.settledBy === "MORBIN" && <Row label="Speed">{rc.speed === "INSTANT" ? "Instant" : "Normal"}</Row>}
              </div>
              <Separator />
              <div className="space-y-2">
                <Row label="To customer">
                  <Money paise={rc.amountPaise} />
                </Row>
                {rc.costPaise > 0 && (
                  <Row label="Refund costs">
                    <Money paise={rc.costPaise} />
                  </Row>
                )}
                {rc.arn && <Row label="Bank reference (ARN)">{rc.arn}</Row>}
                {rc.manualReference && <Row label="Payment reference">{rc.manualReference}</Row>}
              </div>
              <Separator />
              <div className="space-y-2 text-sm">
                <p className="font-medium">Reason</p>
                <p className="text-muted-foreground">{rc.reason}</p>
                {rc.decisionNote && (
                  <>
                    <p className="pt-2 font-medium">Morbin’s note</p>
                    <p className="text-muted-foreground">{rc.decisionNote}</p>
                  </>
                )}
              </div>
              {viewer === "ADMIN" && (
                <>
                  <Separator />
                  <div className="space-y-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium">Emails to the customer</p>
                      <PromptAction
                        trigger={
                          <Button variant="outline" size="sm">
                            <MailIcon data-icon="inline-start" />
                            Email the customer
                          </Button>
                        }
                        title={`Email ${rc.customerName}`}
                        description="Sent from Morbin; their reply goes to the support inbox. The email reminds them Morbin never asks for OTPs or passwords — never ask for those, and only ask for bank details when a manual refund needs them."
                        label="Message"
                        multiline
                        minLength={10}
                        confirmLabel="Send"
                        action={(text) => emailCustomerAction(rc.id, text)}
                      />
                    </div>
                    {rc.messages.length === 0 ? (
                      <p className="text-muted-foreground">No emails yet.</p>
                    ) : (
                      rc.messages.map((m) => (
                        <div key={m.id} className="space-y-1 rounded-lg border p-3">
                          <p className="text-xs text-muted-foreground">
                            Morbin · <DateTime value={m.createdAt} mode="relative" />
                            {m.delivery ? ` · ${m.delivery === "SENT" ? "sent" : m.delivery === "FAILED" ? "failed to send" : "sending"}` : ""}
                          </p>
                          <p className="whitespace-pre-wrap">{m.message}</p>
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}
              <Separator />
              <div className="space-y-2">
                <Row label="Requested">
                  <DateTime value={rc.createdAt} />
                </Row>
                {rc.decidedAt && (
                  <Row label="Decided">
                    <DateTime value={rc.decidedAt} />
                  </Row>
                )}
                {rc.completedAt && (
                  <Row label="Completed">
                    <DateTime value={rc.completedAt} />
                  </Row>
                )}
              </div>
            </div>
            <SheetFooter className="flex-row flex-wrap justify-end gap-2">
              <CaseActions rc={rc} viewer={viewer} balancePaise={balancePaise} />
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

export function RefundCasesTable({
  rows,
  viewer,
  balancePaise = null,
}: {
  rows: RefundRow[];
  viewer: Viewer;
  /** Morbin's Razorpay balance, when known: approving above it shows a warning. */
  balancePaise?: number | null;
}) {
  const [open, setOpen] = useState<RefundRow | null>(null);
  const columns: ColumnDef<RefundRow, unknown>[] = [
    {
      id: "customer",
      header: "Customer",
      enableHiding: false,
      accessorFn: (r) => `${r.customerName} ${r.customerEmail} ${r.eventTitle} ${r.organizationName ?? ""}`,
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.original.customerName}</p>
          <p className="truncate text-xs text-muted-foreground">
            {row.original.eventTitle}
            {row.original.organizationName ? ` · ${row.original.organizationName}` : ""}
          </p>
        </div>
      ),
    },
    { accessorKey: "amountPaise", header: "Amount", cell: ({ row }) => <Money paise={row.original.amountPaise} /> },
    {
      accessorKey: "settledBy",
      header: "Settled by",
      filterFn: "equalsString",
      cell: ({ row }) => (row.original.settledBy === "MORBIN" ? "Morbin" : "Organisation"),
    },
    {
      accessorKey: "status",
      header: "Status",
      filterFn: "equalsString",
      cell: ({ row }) => <StatusBadge kind="refund" value={row.original.status} />,
    },
    {
      accessorKey: "createdAt",
      header: "Requested",
      sortingFn: "datetime",
      cell: ({ row }) => <DateTime value={row.original.createdAt} mode="relative" />,
    },
  ];
  return (
    <>
      <DataTable
        columns={columns}
        data={rows}
        onRowClick={(r) => setOpen(r)}
        searchPlaceholder="Search customer or event…"
        filters={[
          {
            columnId: "status",
            label: "Status",
            options: Object.entries(STATUS.refund).map(([value, m]) => ({ value, label: m.label })),
          },
          {
            columnId: "settledBy",
            label: "Settled by",
            options: [
              { value: "MORBIN", label: "Morbin" },
              { value: "ORGANISATION", label: "Organisation" },
            ],
          },
        ]}
        emptyTitle="No refunds"
        emptyDescription={
          viewer === "OWNER"
            ? "Request a refund from any paid order (Orders → open an order)."
            : "Refund requests from organisations appear here."
        }
        initialSorting={[{ id: "createdAt", desc: true }]}
      />
      <CaseSheet
        rc={open ? (rows.find((r) => r.id === open.id) ?? open) : null}
        viewer={viewer}
        balancePaise={balancePaise}
        onClose={() => setOpen(null)}
      />
    </>
  );
}

