"use client";

import { EyeIcon, EyeOffIcon, MoreHorizontalIcon, PauseIcon, PencilIcon, PlayIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmAction } from "@/components/patterns/confirm-action";
import { FormDialog } from "@/components/patterns/form-dialog";
import { Money } from "@/components/patterns/money";
import { EmptyState } from "@/components/patterns/states";
import {
  createTicketTypeAction,
  deleteTicketTypeAction,
  setTicketTypeStatusAction,
  updateTicketTypeAction,
} from "@/components/features/events/actions";
import { TicketTypeFields } from "./ticket-type-fields";

export interface TicketTypeRow {
  id: string;
  name: string;
  description: string;
  pricePaise: number;
  capacity: number;
  sold: number;
  status: "ACTIVE" | "PAUSED" | "HIDDEN";
  maxPerOrder: number | null;
  /** datetime-local strings (IST) for the edit form */
  saleStartsAt: string;
  saleEndsAt: string;
  /** Human summary of the sale window, if any. */
  saleWindow: string | null;
  hasOrders: boolean;
}

const STATUS_BADGE: Record<TicketTypeRow["status"], { label: string; variant: "secondary" | "outline" }> = {
  ACTIVE: { label: "On sale", variant: "secondary" },
  PAUSED: { label: "Paused", variant: "outline" },
  HIDDEN: { label: "Hidden", variant: "outline" },
};

/**
 * An event's ticket types with every action an organiser needs: add, edit,
 * pause/resume, hide/show, delete. Rules (price lock, capacity floor, delete
 * only without orders) are enforced on the server; this reflects them so the
 * person isn't offered an action that would only be refused.
 */
export function TicketTypesCard({
  eventId,
  rows,
  canManage,
  locked,
}: {
  eventId: string;
  rows: TicketTypeRow[];
  canManage: boolean;
  /** Event cancelled or ended — no changes possible. */
  locked: string | null;
}) {
  const [editing, setEditing] = useState<TicketTypeRow | null>(null);
  const [deleting, setDeleting] = useState<TicketTypeRow | null>(null);
  const editable = canManage && !locked;

  const addButton = (
    <FormDialog
      trigger={
        <Button size="sm">
          <PlusIcon data-icon="inline-start" />
          Add ticket type
        </Button>
      }
      title="Add a ticket type"
      description="Buyers choose from these when booking."
      submitLabel="Add"
      action={(fd) => createTicketTypeAction(eventId, fd)}
      className="sm:max-w-lg"
    >
      {(errors) => <TicketTypeFields errors={errors} />}
    </FormDialog>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ticket types</CardTitle>
        <CardDescription>
          {locked ?? "Prices are what buyers pay for the ticket itself; any convenience fee is shown separately."}
        </CardDescription>
        {editable && rows.length > 0 && <CardAction>{addButton}</CardAction>}
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState
            title="No ticket types yet"
            description={editable ? "Add at least one before publishing." : "The owner hasn't added any yet."}
            action={editable ? addButton : undefined}
          />
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead>Name</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Sold</TableHead>
                  <TableHead>Status</TableHead>
                  {editable && <TableHead className="w-10"><span className="sr-only">Actions</span></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>
                      <p className="font-medium">{t.name}</p>
                      {t.saleWindow && <p className="text-xs text-muted-foreground">{t.saleWindow}</p>}
                    </TableCell>
                    <TableCell>{t.pricePaise === 0 ? "Free" : <Money paise={t.pricePaise} />}</TableCell>
                    <TableCell>
                      <div className="flex min-w-28 items-center gap-2">
                        <Progress value={(t.sold / t.capacity) * 100} className="h-1.5" />
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {t.sold}/{t.capacity}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_BADGE[t.status].variant}>
                        {t.sold >= t.capacity && t.status === "ACTIVE" ? "Sold out" : STATUS_BADGE[t.status].label}
                      </Badge>
                    </TableCell>
                    {editable && (
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${t.name}`} />}>
                            <MoreHorizontalIcon />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem onClick={() => setEditing(t)}>
                              <PencilIcon />
                              Edit
                            </DropdownMenuItem>
                            {t.status === "ACTIVE" ? (
                              <DropdownMenuItem onClick={() => void setTicketTypeStatusAction(eventId, t.id, "PAUSED").then(toastResult)}>
                                <PauseIcon />
                                Pause sales
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem onClick={() => void setTicketTypeStatusAction(eventId, t.id, "ACTIVE").then(toastResult)}>
                                <PlayIcon />
                                Resume sales
                              </DropdownMenuItem>
                            )}
                            {t.status !== "HIDDEN" ? (
                              <DropdownMenuItem onClick={() => void setTicketTypeStatusAction(eventId, t.id, "HIDDEN").then(toastResult)}>
                                <EyeOffIcon />
                                Hide from buyers
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem onClick={() => void setTicketTypeStatusAction(eventId, t.id, "PAUSED").then(toastResult)}>
                                <EyeIcon />
                                Show (paused)
                              </DropdownMenuItem>
                            )}
                            {!t.hasOrders && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem variant="destructive" onClick={() => setDeleting(t)}>
                                  <Trash2Icon />
                                  Delete
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {editing && (
        <FormDialog
          key={editing.id}
          open
          onOpenChange={(o) => !o && setEditing(null)}
          title={`Edit ${editing.name}`}
          submitLabel="Save"
          action={(fd) => updateTicketTypeAction(eventId, editing.id, fd)}
          onSuccess={() => setEditing(null)}
          className="sm:max-w-lg"
        >
          {(errors) => (
            <TicketTypeFields
              errors={errors}
              priceLocked={editing.sold > 0}
              soldCount={editing.sold}
              defaults={{
                name: editing.name,
                description: editing.description,
                price: (editing.pricePaise / 100).toString(),
                capacity: String(editing.capacity),
                maxPerOrder: editing.maxPerOrder ? String(editing.maxPerOrder) : "",
                saleStartsAt: editing.saleStartsAt,
                saleEndsAt: editing.saleEndsAt,
              }}
            />
          )}
        </FormDialog>
      )}
      {deleting && (
        <ConfirmAction
          open
          onOpenChange={(o) => !o && setDeleting(null)}
          title={`Delete ${deleting.name}?`}
          description="This can't be undone. It has no orders, so nobody is affected."
          confirmLabel="Delete"
          destructive
          action={() => deleteTicketTypeAction(eventId, deleting.id)}
          onSuccess={() => setDeleting(null)}
        />
      )}
    </Card>
  );
}

async function toastResult(result: { ok: boolean; message?: string; error?: string }) {
  const { toast } = await import("sonner");
  if (result.ok) toast.success(result.message ?? "Saved");
  else toast.error(result.error ?? "Something went wrong");
}
