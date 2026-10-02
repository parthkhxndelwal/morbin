"use client";

import { MailIcon, RotateCwIcon, UserMinusIcon, UserPlusIcon, XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmAction } from "@/components/patterns/confirm-action";
import { FormDialog } from "@/components/patterns/form-dialog";
import { DateTime } from "@/components/patterns/money";
import { EmptyState } from "@/components/patterns/states";
import type { TeamInviteRow, TeamMemberRow } from "@/lib/team";
import { inviteMemberAction, removeMemberAction, resendInviteAction, revokeInviteAction } from "./actions";

/** Opens the invite dialog. The server decides whether it's a direct add or an emailed invite. */
export function InviteMemberButton({ memberLabel }: { memberLabel: string }) {
  return (
    <FormDialog
      trigger={
        <Button>
          <UserPlusIcon data-icon="inline-start" />
          Invite
        </Button>
      }
      title={`Invite ${memberLabel.toLowerCase()}`}
      description="They can see your events and check tickets in at the door. They can't change events, see money, or refund."
      submitLabel="Send invite"
      action={inviteMemberAction}
    >
      {(errors) => (
        <FieldGroup>
          <Field data-invalid={!!errors.email || undefined}>
            <FieldLabel htmlFor="invite-email">Email</FieldLabel>
            <Input
              id="invite-email"
              name="email"
              type="email"
              autoComplete="off"
              placeholder="name@example.com"
              aria-invalid={!!errors.email || undefined}
              required
            />
            <FieldDescription>
              If they already use Morbin they&apos;re added straight away; otherwise they get a link
              to set up an account.
            </FieldDescription>
            <FieldError>{errors.email}</FieldError>
          </Field>
          <Field data-invalid={!!errors.name || undefined}>
            <FieldLabel htmlFor="invite-name">Name (optional)</FieldLabel>
            <Input id="invite-name" name="name" autoComplete="off" aria-invalid={!!errors.name || undefined} />
            <FieldError>{errors.name}</FieldError>
          </Field>
        </FieldGroup>
      )}
    </FormDialog>
  );
}

function RoleBadge({ member, memberLabel }: { member: TeamMemberRow; memberLabel: string }) {
  return member.isOwner ? <Badge>Owner</Badge> : <Badge variant="secondary">{memberLabel}</Badge>;
}

export function TeamView({
  members,
  invites,
  canManage,
  memberLabel,
}: {
  members: TeamMemberRow[];
  invites: TeamInviteRow[];
  canManage: boolean;
  memberLabel: string;
}) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>People</CardTitle>
          <CardDescription>
            {members.length} {members.length === 1 ? "person" : "people"} can sign in to this organisation.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="hidden sm:table-cell">Joined</TableHead>
                  {canManage && <TableHead className="w-0" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => (
                  <TableRow key={m.userId}>
                    <TableCell>
                      <p className="font-medium">
                        {m.name}
                        {m.isYou && <span className="text-muted-foreground"> (you)</span>}
                      </p>
                      <p className="text-xs text-muted-foreground">{m.email}</p>
                    </TableCell>
                    <TableCell>
                      <RoleBadge member={m} memberLabel={memberLabel} />
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <DateTime value={m.joinedAt} mode="date" />
                    </TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        {!m.isOwner && !m.isYou && (
                          <ConfirmAction
                            trigger={
                              <Button variant="ghost" size="sm" aria-label={`Remove ${m.name}`}>
                                <UserMinusIcon data-icon="inline-start" />
                                Remove
                              </Button>
                            }
                            title={`Remove ${m.name}?`}
                            description="They lose access to this organisation immediately. Their account stays, and you can invite them again later."
                            confirmLabel="Remove"
                            destructive
                            action={() => removeMemberAction(m.userId)}
                          />
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>Pending invites</CardTitle>
            <CardDescription>Links are valid for 7 days. Resending sends a fresh link and the old one stops working.</CardDescription>
          </CardHeader>
          <CardContent>
            {invites.length === 0 ? (
              <EmptyState
                icon={<MailIcon />}
                title="No pending invites"
                description="Invite the people working your door — they'll only see events and check-in."
              />
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead>Invited</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-0" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invites.map((i) => (
                      <TableRow key={i.id}>
                        <TableCell>
                          <p className="font-medium">{i.name ?? i.email}</p>
                          {i.name && <p className="text-xs text-muted-foreground">{i.email}</p>}
                          <p className="text-xs text-muted-foreground">
                            Sent <DateTime value={i.lastSentAt} mode="relative" />
                          </p>
                        </TableCell>
                        <TableCell>
                          {i.expired ? (
                            <Badge variant="outline">Expired</Badge>
                          ) : (
                            <span className="text-sm text-muted-foreground">
                              Expires <DateTime value={i.expiresAt} mode="date" />
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            {i.canResend && (
                              <ConfirmAction
                                trigger={
                                  <Button variant="ghost" size="sm">
                                    <RotateCwIcon data-icon="inline-start" />
                                    Resend
                                  </Button>
                                }
                                title={`Resend the invite to ${i.email}?`}
                                description="They get a new link, valid for 7 days. The previous link stops working."
                                confirmLabel="Resend"
                                action={() => resendInviteAction(i.id)}
                              />
                            )}
                            <ConfirmAction
                              trigger={
                                <Button variant="ghost" size="sm" aria-label={`Revoke the invite to ${i.email}`}>
                                  <XIcon data-icon="inline-start" />
                                  Revoke
                                </Button>
                              }
                              title="Revoke this invite?"
                              description="The link stops working straight away."
                              confirmLabel="Revoke"
                              destructive
                              action={() => revokeInviteAction(i.id)}
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
