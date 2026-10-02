"use client";

import {
  BadgeCheckIcon,
  BanknoteIcon,
  EyeIcon,
  FileUpIcon,
  MessageSquareReplyIcon,
  ReceiptTextIcon,
  SendIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmAction } from "@/components/patterns/confirm-action";
import { CopyButton } from "@/components/patterns/copy-button";
import { FormDialog } from "@/components/patterns/form-dialog";
import { DateTime, Money } from "@/components/patterns/money";
import { EmptyState } from "@/components/patterns/states";
import type { PayableOrgRow } from "@/lib/admin-desk";
import type { PayoutDetail } from "@/lib/dashboard-data";
import type { Result } from "@/lib/result";
import type { PayoutTotals } from "@/lib/types";
import {
  cancelPayoutAction,
  issuePayoutAction,
  issueFeeInvoiceAction,
  markPayoutPaidAction,
  previewPayoutAction,
  replaceStatementAction,
  replyToQueryAction,
  revealAccountNumberAction,
  verifyAccountAction,
} from "./actions";

/* ── Issue ──────────────────────────────────────────────────────────────── */

/** What a payout with this cut-off would contain, fetched as the admin types. */
function PayoutPreview({ organizationId }: { organizationId: string }) {
  const [cutoff, setCutoff] = useState("");
  const [preview, setPreview] = useState<{
    key: string;
    data: { totals: PayoutTotals; count: number } | null;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    let live = true;
    const key = cutoff;
    const t = setTimeout(() => {
      previewPayoutAction(organizationId, cutoff).then((r) => {
        if (live) setPreview(r.ok ? { key, data: r.data, error: null } : { key, data: null, error: r.error });
      });
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [organizationId, cutoff]);

  const current = preview?.key === cutoff ? preview : null;
  return (
    <>
      <Field>
        <FieldLabel htmlFor="payout-cutoff">Include everything up to</FieldLabel>
        <Input
          id="payout-cutoff"
          name="cutoff"
          type="datetime-local"
          value={cutoff}
          onChange={(e) => setCutoff(e.target.value)}
        />
        <FieldDescription>Leave empty for “now”. Times are IST.</FieldDescription>
      </Field>
      <div className="space-y-2 rounded-lg border p-3 text-sm">
        {!current ? (
          <Skeleton className="h-16 w-full" />
        ) : current.error ? (
          <p className="text-destructive">{current.error}</p>
        ) : current.data && current.data.count > 0 ? (
          <>
            <Row label="Ticket sales" paise={current.data.totals.salesPaise} />
            <Row label="Platform fees" paise={current.data.totals.feesPaise} />
            <Row label="Refunds and costs" paise={current.data.totals.refundsPaise + current.data.totals.refundCostsPaise} />
            <Row label="Adjustments" paise={current.data.totals.adjustmentsPaise} />
            <Separator />
            <Row label={`Net payout · ${current.data.count} entries`} paise={current.data.totals.netPaise} strong />
          </>
        ) : (
          <p className="text-muted-foreground">Nothing unsettled up to this time.</p>
        )}
      </div>
    </>
  );
}

function Row({ label, paise, strong }: { label: string; paise: number; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${strong ? "font-semibold" : ""}`}>
      <span className={strong ? "" : "text-muted-foreground"}>{label}</span>
      <Money paise={paise} />
    </div>
  );
}

export function IssuePayoutButton({ organizationId, organizationName }: { organizationId: string; organizationName: string }) {
  return (
    <FormDialog
      trigger={
        <Button size="sm">
          <BanknoteIcon data-icon="inline-start" />
          Issue payout
        </Button>
      }
      title={`Issue a payout to ${organizationName}`}
      description="Creates a draft that locks these ledger entries. Mark it paid once the bank transfer is made."
      submitLabel="Create draft"
      action={(fd) => issuePayoutAction(organizationId, fd)}
      onSuccess={(data) => `/dashboard/admin/payouts/${data.id}`}
    >
      {(errors) => (
        <FieldGroup>
          <PayoutPreview organizationId={organizationId} />
          <Field data-invalid={!!errors.note || undefined}>
            <FieldLabel htmlFor="payout-note">Note to the organisation (optional)</FieldLabel>
            <Textarea id="payout-note" name="note" rows={2} maxLength={500} />
            <FieldError>{errors.note}</FieldError>
          </Field>
        </FieldGroup>
      )}
    </FormDialog>
  );
}

export function PayableOrgsTable({ rows }: { rows: PayableOrgRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<BanknoteIcon />}
        title="Nothing to pay out"
        description="Organisations appear here as soon as they have unsettled sales."
      />
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead>Organisation</TableHead>
            <TableHead className="text-right">Unpaid balance</TableHead>
            <TableHead className="hidden md:table-cell">Bank account</TableHead>
            <TableHead className="w-0" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.organizationId}>
              <TableCell>
                <p className="font-medium">{r.organizationName}</p>
                <p className="text-xs text-muted-foreground">
                  {r.entryCount} entries since <DateTime value={r.oldestEntryAt} mode="date" />
                </p>
              </TableCell>
              <TableCell className="text-right">
                <Money paise={r.unsettledPaise} />
              </TableCell>
              <TableCell className="hidden md:table-cell">
                {r.account ? (
                  <span className="flex items-center gap-2 text-sm">
                    •••• {r.account.last4}
                    {r.account.verified ? (
                      <Badge variant="secondary">Verified</Badge>
                    ) : (
                      <Badge variant="outline">Unverified</Badge>
                    )}
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground">Not on file</span>
                )}
              </TableCell>
              <TableCell className="text-right">
                {r.hasDraft ? (
                  <Badge variant="outline">Draft open</Badge>
                ) : r.unsettledPaise > 0 ? (
                  <IssuePayoutButton organizationId={r.organizationId} organizationName={r.organizationName} />
                ) : (
                  <span className="text-xs text-muted-foreground">Owes Morbin</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/* ── Bank account ───────────────────────────────────────────────────────── */

export function PayoutAccountCard({
  organizationId,
  account,
}: {
  organizationId: string;
  account: { accountName: string; ifsc: string; last4: string; verified: boolean } | null;
}) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function reveal() {
    setPending(true);
    setError(null);
    const r = await revealAccountNumberAction(organizationId);
    setPending(false);
    if (r.ok) setRevealed(r.data);
    else setError(r.error);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pay to</CardTitle>
        <CardDescription>The organisation&apos;s payout account. Revealing the number is audit-logged.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!account ? (
          <Alert>
            <AlertTitle>No bank account on file</AlertTitle>
            <AlertDescription>Ask the owner to add one under Settings → Payout bank details.</AlertDescription>
          </Alert>
        ) : (
          <>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Account holder</span>
              <span className="text-right">{account.accountName}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">IFSC</span>
              <span className="font-mono">{account.ifsc}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">Account number</span>
              {revealed ? (
                <span className="flex items-center gap-1 font-mono">
                  {revealed}
                  <CopyButton value={revealed} label="Copy account number" />
                </span>
              ) : (
                <Button variant="outline" size="sm" onClick={reveal} disabled={pending}>
                  <EyeIcon data-icon="inline-start" />
                  •••• {account.last4} — reveal
                </Button>
              )}
            </div>
            {error && <p className="text-destructive">{error}</p>}
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">Status</span>
              {account.verified ? (
                <Badge variant="secondary">Verified</Badge>
              ) : (
                <ConfirmAction
                  trigger={
                    <Button variant="outline" size="sm">
                      <BadgeCheckIcon data-icon="inline-start" />
                      Mark verified
                    </Button>
                  }
                  title="Mark this account verified?"
                  description="Do this after confirming the account holder matches the organisation (for example with a ₹1 test transfer)."
                  confirmLabel="Mark verified"
                  action={() => verifyAccountAction(organizationId)}
                />
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* ── One payout ─────────────────────────────────────────────────────────── */

/** Mirrors the server's limit; a larger body never reaches the action at all. */
const MAX_STATEMENT_BYTES = 10 * 1024 * 1024;

/**
 * Check the statement's size in the browser first: an oversized request is
 * rejected by the framework before the action runs, which would surface only
 * as a generic failure.
 */
function withStatementCheck<T>(send: (fd: FormData) => Promise<Result<T>>) {
  return async (fd: FormData): Promise<Result<T>> => {
    const file = fd.get("statement");
    if (file instanceof File && file.size > MAX_STATEMENT_BYTES) {
      const message = `This file is ${(file.size / 1024 / 1024).toFixed(1)} MB. Statements must be under 10 MB.`;
      return { ok: false, error: message, fieldErrors: { statement: message } };
    }
    return send(fd);
  };
}

function StatementField({ error }: { error?: string }) {
  return (
    <Field data-invalid={!!error || undefined}>
      <FieldLabel htmlFor="payout-statement">Settlement statement (PDF)</FieldLabel>
      <Input id="payout-statement" name="statement" type="file" accept="application/pdf" required />
      <FieldDescription>Up to 10 MB. The organisation downloads it from their payout page.</FieldDescription>
      <FieldError>{error}</FieldError>
    </Field>
  );
}

export function AdminPayoutActions({ payout }: { payout: PayoutDetail }) {
  if (payout.status === "CANCELLED") return null;
  if (payout.status === "DRAFT") {
    return (
      <>
        <ConfirmAction
          trigger={
            <Button variant="outline">
              <XIcon data-icon="inline-start" />
              Cancel draft
            </Button>
          }
          title="Cancel this draft?"
          description="Its ledger entries go back to the organisation's unpaid balance."
          confirmLabel="Cancel draft"
          destructive
          action={() => cancelPayoutAction(payout.id)}
        />
        <FormDialog
          trigger={
            <Button>
              <SendIcon data-icon="inline-start" />
              Mark paid
            </Button>
          }
          title="Record the transfer"
          description={
            <>
              Transfer <Money paise={payout.netPaise} /> first, then record it here. The owner is notified and asked
              to acknowledge.
            </>
          }
          submitLabel="Mark paid"
          action={withStatementCheck((fd) => markPayoutPaidAction(payout.id, fd))}
        >
          {(errors) => (
            <FieldGroup>
              <Field data-invalid={!!errors.bankReference || undefined}>
                <FieldLabel htmlFor="payout-utr">UTR / transfer reference</FieldLabel>
                <Input id="payout-utr" name="bankReference" autoComplete="off" required />
                <FieldError>{errors.bankReference}</FieldError>
              </Field>
              <Field data-invalid={!!errors.transferredAt || undefined}>
                <FieldLabel htmlFor="payout-transferred">Transferred at (IST)</FieldLabel>
                <Input id="payout-transferred" name="transferredAt" type="datetime-local" required />
                <FieldError>{errors.transferredAt}</FieldError>
              </Field>
              <StatementField error={errors.statement} />
            </FieldGroup>
          )}
        </FormDialog>
      </>
    );
  }
  return (
    <>
      {payout.totals.feesPaise !== 0 && !payout.invoiceDocId && (
        <ConfirmAction
          trigger={
            <Button variant="outline">
              <ReceiptTextIcon data-icon="inline-start" />
              Issue fee invoice
            </Button>
          }
          title="Issue the platform fee invoice?"
          description="Uses the next invoice number and Morbin's current GST details. Do this once Admin → Settings is complete."
          confirmLabel="Issue invoice"
          action={() => issueFeeInvoiceAction(payout.id)}
        />
      )}
      <FormDialog
        trigger={
          <Button variant="outline">
            <FileUpIcon data-icon="inline-start" />
            Replace statement
          </Button>
        }
        title="Replace the statement"
        description="The previous file stays in the audit trail; the organisation sees the new one."
        submitLabel="Upload"
        action={withStatementCheck((fd) => replaceStatementAction(payout.id, fd))}
      >
        {(errors) => (
          <FieldGroup>
            <StatementField error={errors.statement} />
          </FieldGroup>
        )}
      </FormDialog>
      {payout.status === "DISPUTED" && (
        <FormDialog
          trigger={
            <Button>
              <MessageSquareReplyIcon data-icon="inline-start" />
              Reply to query
            </Button>
          }
          title="Reply to the organisation"
          submitLabel="Send reply"
          action={(fd) => replyToQueryAction(payout.id, fd)}
        >
          {(errors) => (
            <FieldGroup>
              <Field data-invalid={!!errors.message || undefined}>
                <FieldLabel htmlFor="reply-message">Message</FieldLabel>
                <Textarea id="reply-message" name="message" rows={4} maxLength={2000} required />
                <FieldError>{errors.message}</FieldError>
              </Field>
              <Field data-invalid={!!errors.adjustment || undefined}>
                <FieldLabel htmlFor="reply-adjustment">Adjustment (₹, optional)</FieldLabel>
                <Input id="reply-adjustment" name="adjustment" inputMode="decimal" placeholder="e.g. 250 or -250" />
                <FieldDescription>
                  Booked to the ledger now and settled in the organisation&apos;s next payout.
                </FieldDescription>
                <FieldError>{errors.adjustment}</FieldError>
              </Field>
              <Field orientation="horizontal">
                <Checkbox id="reply-resolve" name="resolve" value="on" />
                <FieldLabel htmlFor="reply-resolve">Mark the query resolved</FieldLabel>
              </Field>
            </FieldGroup>
          )}
        </FormDialog>
      )}
    </>
  );
}
