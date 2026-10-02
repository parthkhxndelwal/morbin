"use client";

import { CheckCircle2Icon, CircleIcon, RocketIcon, UndoIcon, XCircleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmAction } from "@/components/patterns/confirm-action";
import { formatINR } from "@/lib/format";
import type { CancellationPreview } from "@/lib/event-service";
import { cancelEventAction, previewCancellationAction, setEventStatusAction } from "./actions";

/**
 * Where an event is in its life and what can happen next. Draft: a checklist of
 * what's missing, and Publish once nothing is. Published: unpublish (only while
 * nobody has booked) or cancel (which refunds everyone, previewed first).
 */
export function EventStatusCard({
  eventId,
  status,
  blockers,
  hasBookings,
  canManage,
}: {
  eventId: string;
  status: "DRAFT" | "PUBLISHED" | "CANCELLED" | "ENDED";
  blockers: string[];
  hasBookings: boolean;
  canManage: boolean;
}) {
  if (status === "CANCELLED") {
    return (
      <Alert variant="destructive">
        <XCircleIcon />
        <AlertTitle>This event is cancelled</AlertTitle>
        <AlertDescription>Sales are stopped. Refunds for existing bookings are tracked under Refunds.</AlertDescription>
      </Alert>
    );
  }
  if (status === "ENDED") {
    return (
      <Alert>
        <CheckCircle2Icon />
        <AlertTitle>This event has ended</AlertTitle>
        <AlertDescription>Its sales are included in your next payout.</AlertDescription>
      </Alert>
    );
  }

  if (status === "DRAFT") {
    const ready = blockers.length === 0;
    return (
      <Card>
        <CardHeader>
          <CardTitle>{ready ? "Ready to publish" : "Before you publish"}</CardTitle>
          <CardDescription>
            {ready
              ? "Publishing makes the event page live and opens booking."
              : "Finish these and the event can go live."}
          </CardDescription>
        </CardHeader>
        {!ready && (
          <CardContent>
            <ul className="space-y-2 text-sm">
              {blockers.map((b) => (
                <li key={b} className="flex items-start gap-2">
                  <CircleIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  {b}
                </li>
              ))}
            </ul>
          </CardContent>
        )}
        {canManage && (
          <CardFooter>
            <ConfirmAction
              trigger={
                <Button disabled={!ready}>
                  <RocketIcon data-icon="inline-start" />
                  Publish event
                </Button>
              }
              title="Publish this event?"
              description="The public page goes live and people can book straight away."
              confirmLabel="Publish"
              action={() => setEventStatusAction(eventId, "PUBLISHED")}
            />
          </CardFooter>
        )}
      </Card>
    );
  }

  if (!canManage) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Live and selling</CardTitle>
        <CardDescription>
          {hasBookings
            ? "People have booked, so this event can only be cancelled — which refunds everyone."
            : "Nobody has booked yet. You can still take it back to draft."}
        </CardDescription>
      </CardHeader>
      <CardFooter className="gap-2">
        {!hasBookings && (
          <ConfirmAction
            trigger={
              <Button variant="outline">
                <UndoIcon data-icon="inline-start" />
                Unpublish
              </Button>
            }
            title="Move back to draft?"
            description="The public page stops accepting bookings until you publish again."
            confirmLabel="Unpublish"
            action={() => setEventStatusAction(eventId, "DRAFT")}
          />
        )}
        <CancelEventButton eventId={eventId} />
      </CardFooter>
    </Card>
  );
}

function CancelEventButton({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<CancellationPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function openDialog() {
    setOpen(true);
    setPreview(null);
    setLoadError(null);
    setError(null);
    const r = await previewCancellationAction(eventId);
    if (r.ok) setPreview(r.data);
    else setLoadError(r.error);
  }

  function confirm() {
    setError(null);
    startTransition(async () => {
      const r = await cancelEventAction(eventId, reason);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setOpen(false);
      toast.success(r.message ?? "Event cancelled");
      if (r.data.failed > 0) {
        toast.warning(
          `${r.data.failed} refund request(s) couldn't be raised because the balance didn't cover them. Morbin support has been notified.`,
        );
      }
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="destructive" onClick={openDialog}>
        <XCircleIcon data-icon="inline-start" />
        Cancel event
      </Button>
      <AlertDialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this event?</AlertDialogTitle>
            <AlertDialogDescription>
              Sales stop immediately and every buyer is emailed. Each order is put up for a refund (ticket price
              only — convenience fees are non-refundable), which Morbin approves.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {!preview && !loadError && (
            <div className="space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          )}
          {loadError && <p className="text-sm text-destructive">{loadError}</p>}
          {preview && (
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 rounded-lg border p-3 text-sm">
              <dt className="text-muted-foreground">Orders to refund</dt>
              <dd className="tabular-nums">{preview.orders}</dd>
              <dt className="text-muted-foreground">Refund to customers</dt>
              <dd className="tabular-nums">{formatINR(preview.refundPaise)}</dd>
              <dt className="text-muted-foreground">Refund costs (Razorpay)</dt>
              <dd className="tabular-nums">{formatINR(preview.costPaise)}</dd>
              <dt className="text-muted-foreground">Your unpaid balance</dt>
              <dd className="tabular-nums">{formatINR(preview.unsettledPaise)}</dd>
            </dl>
          )}
          {preview && preview.shortfallPaise > 0 && (
            <Alert variant="destructive">
              <AlertTitle>Balance short by {formatINR(preview.shortfallPaise)}</AlertTitle>
              <AlertDescription>
                You can still cancel. Refunds the balance can’t cover will wait for Morbin support.
              </AlertDescription>
            </Alert>
          )}

          <Field>
            <FieldLabel htmlFor="cancel-reason">Reason (sent to buyers)</FieldLabel>
            <Textarea
              id="cancel-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="e.g. The venue is unavailable due to weather."
            />
            <FieldDescription>This can’t be undone.</FieldDescription>
          </Field>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Keep event</AlertDialogCancel>
            <Button variant="destructive" onClick={confirm} disabled={pending || !preview || reason.trim().length < 5}>
              {pending && <Spinner data-icon="inline-start" />}
              Cancel event
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
