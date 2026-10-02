"use client";

import { MailIcon, PauseCircleIcon, PencilIcon, PlayCircleIcon, Trash2Icon, UserMinusIcon, UserPlusIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmAction } from "@/components/patterns/confirm-action";
import { FormDialog } from "@/components/patterns/form-dialog";
import { DateTime, Money } from "@/components/patterns/money";
import { PromptAction } from "@/components/patterns/prompt-action";
import { EmptyState } from "@/components/patterns/states";
import type { AdminOrgDetail } from "@/lib/admin-orgs";
import { computePricing } from "@/lib/pricing";
import { STATUS } from "@/lib/status";
import type { TeamInviteRow, TeamMemberRow } from "@/lib/team";
import {
  adminInviteMemberAction,
  adminRemoveMemberAction,
  adminRevokeInviteAction,
  deleteOrganizationAction,
  resendOwnerSetupAction,
  setFeeAction,
  setRetentionAction,
  setSuspendedAction,
  updateOrganizationAction,
} from "./actions";

const pct = (bps: number) => `${(bps / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}%`;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right break-words">{children}</span>
    </div>
  );
}

/* ── Header actions ─────────────────────────────────────────────────────── */

export function OrgHeaderActions({ org }: { org: AdminOrgDetail }) {
  const router = useRouter();
  const suspended = org.status === "SUSPENDED";
  return (
    <>
      <FormDialog
        trigger={
          <Button variant="outline">
            <PencilIcon data-icon="inline-start" />
            Edit
          </Button>
        }
        title="Edit organisation"
        submitLabel="Save"
        action={(fd) => updateOrganizationAction(org.id, fd)}
      >
        {(errors) => (
          <FieldGroup>
            <Field data-invalid={!!errors.name || undefined}>
              <FieldLabel htmlFor="edit-org-name">Name</FieldLabel>
              <Input id="edit-org-name" name="name" defaultValue={org.name} required />
              <FieldError>{errors.name}</FieldError>
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-org-type">Type</FieldLabel>
              <NativeSelect id="edit-org-type" name="type" defaultValue={org.type} className="w-full">
                <NativeSelectOption value="EVENT">Event organiser</NativeSelectOption>
                <NativeSelectOption value="INSTITUTION">Institution</NativeSelectOption>
                <NativeSelectOption value="CORPORATE">Company</NativeSelectOption>
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-org-pay">Payments</FieldLabel>
              <NativeSelect id="edit-org-pay" name="paymentAccountStatus" defaultValue={org.paymentAccountStatus} className="w-full">
                {Object.entries(STATUS.paymentAccount).map(([v, m]) => (
                  <NativeSelectOption key={v} value={v}>
                    {m.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <FieldDescription>Only verified organisations can publish paid tickets.</FieldDescription>
            </Field>
          </FieldGroup>
        )}
      </FormDialog>
      <ConfirmAction
        trigger={
          <Button variant="outline">
            {suspended ? <PlayCircleIcon data-icon="inline-start" /> : <PauseCircleIcon data-icon="inline-start" />}
            {suspended ? "Restore" : "Suspend"}
          </Button>
        }
        title={suspended ? `Restore ${org.name}?` : `Suspend ${org.name}?`}
        description={
          suspended
            ? "They can publish and sell again."
            : "Existing tickets still scan at the door, but nothing new can be published or sold. Everything is kept."
        }
        confirmLabel={suspended ? "Restore" : "Suspend"}
        destructive={!suspended}
        action={() => setSuspendedAction(org.id, !suspended)}
      />
      <ConfirmAction
        trigger={
          <Button variant="ghost" className="text-muted-foreground hover:text-destructive">
            <Trash2Icon data-icon="inline-start" />
            Delete
          </Button>
        }
        title={`Delete ${org.name}?`}
        description="Only for organisations that never sold anything. Its draft events go too; the owner's account stays. This can't be undone."
        confirmLabel="Delete"
        destructive
        action={() => deleteOrganizationAction(org.id)}
        onSuccess={() => router.push("/dashboard/admin/orgs")}
      />
    </>
  );
}

/* ── Overview ───────────────────────────────────────────────────────────── */

export function OwnerCard({ org }: { org: AdminOrgDetail }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>What the owner has told us. They edit these under Settings.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <Row label="Owner">
          {org.owner ? (
            <>
              <span className="block">{org.owner.name || org.owner.email}</span>
              <span className="block text-xs text-muted-foreground">{org.owner.email}</span>
            </>
          ) : (
            "None on record"
          )}
        </Row>
        {org.owner && !org.owner.hasPassword && (
          <div className="flex items-center justify-between gap-4 text-sm">
            <Badge variant="outline">Hasn&apos;t set a password yet</Badge>
            <ConfirmAction
              trigger={
                <Button variant="outline" size="sm">
                  <MailIcon data-icon="inline-start" />
                  Resend setup email
                </Button>
              }
              title="Send a new setup link?"
              description="The previous link stops working."
              confirmLabel="Send"
              action={() => resendOwnerSetupAction(org.id)}
            />
          </div>
        )}
        <Row label="Contact email">{org.contact.email ?? "—"}</Row>
        <Row label="Phone">{org.contact.phone ?? "—"}</Row>
        <Row label="GSTIN">{org.contact.gstin ?? "—"}</Row>
        <Row label="Address">{org.contact.address ?? "—"}</Row>
        <Row label="Public slug">
          <span className="font-mono">{org.slug}</span>
        </Row>
        <Row label="Joined">
          <DateTime value={org.createdAt} mode="date" />
        </Row>
      </CardContent>
    </Card>
  );
}

/* ── Fee ────────────────────────────────────────────────────────────────── */

export function FeeCard({ org }: { org: AdminOrgDetail }) {
  const example = computePricing([{ unitPricePaise: 50000, quantity: 1 }], {
    feeBps: org.fee.effectiveBps,
    gstBps: 1800,
    bearer: org.fee.bearer,
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Platform fee</CardTitle>
        <CardDescription>GST-inclusive, on top of the ticket price. Applies to new orders only.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-3xl font-semibold tabular-nums">{pct(org.fee.effectiveBps)}</p>
            <p className="text-sm text-muted-foreground">
              {org.fee.customBps === null ? `Platform default (${pct(org.fee.defaultBps)})` : `Custom rate · default is ${pct(org.fee.defaultBps)}`}
            </p>
          </div>
          <FormDialog
            trigger={<Button variant="outline">Change fee</Button>}
            title="Change the platform fee"
            description="Orders already placed keep the fee they were charged. The owner is notified."
            submitLabel="Save fee"
            action={(fd) => setFeeAction(org.id, fd)}
          >
            {(errors) => (
              <FieldGroup>
                <Field data-invalid={!!errors.fee || undefined}>
                  <FieldLabel htmlFor="fee-pct">Fee, % including GST</FieldLabel>
                  <Input
                    id="fee-pct"
                    name="fee"
                    inputMode="decimal"
                    defaultValue={org.fee.customBps === null ? "" : String(org.fee.customBps / 100)}
                    placeholder={`Empty = platform default (${pct(org.fee.defaultBps)})`}
                  />
                  <FieldError>{errors.fee}</FieldError>
                </Field>
                <Field data-invalid={!!errors.note || undefined}>
                  <FieldLabel htmlFor="fee-note">Why (kept in the history)</FieldLabel>
                  <Textarea id="fee-note" name="note" rows={2} maxLength={300} placeholder="e.g. Agreed rate for 2026 season" />
                  <FieldError>{errors.note}</FieldError>
                </Field>
              </FieldGroup>
            )}
          </FormDialog>
        </div>
        <p className="text-sm text-muted-foreground">
          {org.fee.bearer === "CUSTOMER" ? (
            <>
              Buyers pay it: a ₹500 ticket costs them <Money paise={example.orderTotalPaise} />.
            </>
          ) : (
            <>
              The organisation absorbs it: on a ₹500 ticket they receive <Money paise={example.organiserNetPaise} />.
            </>
          )}
        </p>
        {org.feeHistory.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">History</p>
            <ul className="space-y-1.5 text-sm">
              {org.feeHistory.map((f) => (
                <li key={f.at} className="flex justify-between gap-4">
                  <span>
                    {f.fromBps === null ? "default" : pct(f.fromBps)} → {f.toBps === null ? "default" : pct(f.toBps)}
                    {f.note && <span className="block text-xs text-muted-foreground">{f.note}</span>}
                  </span>
                  <DateTime value={f.at} mode="date" className="shrink-0 text-muted-foreground" />
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function DataCard({ org }: { org: AdminOrgDetail }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Data</CardTitle>
        <CardDescription>How long attendee details are kept after an event ends, then anonymised.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Row label="Keep attendee data for">
          {org.retentionMonths ?? org.defaultRetentionMonths} months
          {org.retentionMonths === null && <span className="block text-xs text-muted-foreground">platform default</span>}
        </Row>
        <PromptAction
          trigger={<Button variant="outline" size="sm">Change retention</Button>}
          title="Change retention"
          description={`Months after an event ends. Leave empty for the platform default (${org.defaultRetentionMonths}).`}
          label="Months"
          placeholder={String(org.defaultRetentionMonths)}
          required={false}
          confirmLabel="Save"
          action={(v) => setRetentionAction(org.id, v)}
        />
        <Row label="Support edits need owner approval">{org.requireApprovalForSupportChanges ? "Yes" : "No"}</Row>
      </CardContent>
    </Card>
  );
}

/* ── Money ──────────────────────────────────────────────────────────────── */

const LEDGER_LABEL: Record<string, string> = {
  SALE: "Sale",
  PLATFORM_FEE: "Platform fee",
  REFUND: "Refund",
  REFUND_REVERSAL: "Refund reversed",
  REFUND_COST: "Refund cost",
  ADJUSTMENT: "Adjustment",
};

export function LedgerTable({ org }: { org: AdminOrgDetail }) {
  if (org.ledger.length === 0) {
    return <EmptyState title="No money yet" description="Sales, fees and refunds appear here as they happen." />;
  }
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead>Entry</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="hidden sm:table-cell">Paid out</TableHead>
            <TableHead className="hidden md:table-cell">When</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {org.ledger.map((l) => (
            <TableRow key={l.id}>
              <TableCell>
                <p className="font-medium">{LEDGER_LABEL[l.type] ?? l.type}</p>
                <p className="text-xs text-muted-foreground">{l.memo}</p>
              </TableCell>
              <TableCell className="text-right">
                <Money paise={l.amountPaise} signed />
              </TableCell>
              <TableCell className="hidden sm:table-cell">{l.settled ? "Yes" : "Not yet"}</TableCell>
              <TableCell className="hidden md:table-cell">
                <DateTime value={l.at} mode="relative" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/* ── Members (as support) ───────────────────────────────────────────────── */

export function AdminMembers({
  organizationId,
  members,
  invites,
}: {
  organizationId: string;
  members: TeamMemberRow[];
  invites: TeamInviteRow[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Members</CardTitle>
        <CardDescription>The owner manages this from their Team page; changes here are made as Morbin support.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <FormDialog
          trigger={
            <Button variant="outline" size="sm">
              <UserPlusIcon data-icon="inline-start" />
              Add a member
            </Button>
          }
          title="Add a member"
          description="Existing Morbin users are added straight away; new people get an email to set up an account."
          submitLabel="Add"
          action={(fd) => adminInviteMemberAction(organizationId, fd)}
        >
          {(errors) => (
            <FieldGroup>
              <Field data-invalid={!!errors.email || undefined}>
                <FieldLabel htmlFor="adm-invite-email">Email</FieldLabel>
                <Input id="adm-invite-email" name="email" type="email" required />
                <FieldError>{errors.email}</FieldError>
              </Field>
              <Field>
                <FieldLabel htmlFor="adm-invite-name">Name (optional)</FieldLabel>
                <Input id="adm-invite-name" name="name" />
              </Field>
            </FieldGroup>
          )}
        </FormDialog>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.userId}>
                  <TableCell>
                    <p className="font-medium">{m.name}</p>
                    <p className="text-xs text-muted-foreground">{m.email}</p>
                  </TableCell>
                  <TableCell>{m.isOwner ? <Badge>Owner</Badge> : <Badge variant="secondary">Member</Badge>}</TableCell>
                  <TableCell className="text-right">
                    {!m.isOwner && (
                      <ConfirmAction
                        trigger={
                          <Button variant="ghost" size="sm" aria-label={`Remove ${m.name}`}>
                            <UserMinusIcon data-icon="inline-start" />
                            Remove
                          </Button>
                        }
                        title={`Remove ${m.name}?`}
                        description="They lose access to this organisation immediately."
                        confirmLabel="Remove"
                        destructive
                        action={() => adminRemoveMemberAction(organizationId, m.userId)}
                      />
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {invites.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>
                    <p className="font-medium">{i.name ?? i.email}</p>
                    <p className="text-xs text-muted-foreground">{i.email}</p>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{i.expired ? "Invite expired" : "Invited"}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <ConfirmAction
                      trigger={
                        <Button variant="ghost" size="sm" aria-label={`Revoke invite to ${i.email}`}>
                          <XIcon data-icon="inline-start" />
                          Revoke
                        </Button>
                      }
                      title="Revoke this invite?"
                      confirmLabel="Revoke"
                      destructive
                      action={() => adminRevokeInviteAction(organizationId, i.id)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
