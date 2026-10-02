"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldContent, FieldDescription, FieldLabel, FieldLegend, FieldSet, FieldTitle } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { formatINR } from "@/lib/format";
import type { OrderDetail } from "@/lib/order-detail";
import type { RefundQuote } from "@/lib/refunds";
import { quoteRefundAction, requestRefundAction, type RefundSelection } from "./actions";

/**
 * Request a refund for some or all of an order's tickets.
 *
 * The figures come from the server (`quoteRefund`) on every change, so what the
 * owner sees is exactly what will be held: ticket value back to the customer,
 * plus any Razorpay cost, against the unpaid balance.
 */
export function RefundRequestDialog({
  order,
  open,
  onOpenChange,
}: {
  order: OrderDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const refundable = order.tickets.filter((t) => t.status !== "REFUNDED" && !t.refundCaseId);
  const [selected, setSelected] = useState<string[]>(refundable.map((t) => t.id));
  const [speed, setSpeed] = useState<RefundSelection["speed"]>("NORMAL");
  const [settledBy, setSettledBy] = useState<RefundSelection["settledBy"]>("MORBIN");
  const [reason, setReason] = useState("");
  const [quoted, setQuoted] = useState<{ key: string; quote: RefundQuote | null; error: string | null } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Each quote is tagged with the selection it answers; a stale one is never shown.
  const quoteKey = open && selected.length > 0 ? JSON.stringify([order.id, selected, speed, settledBy]) : null;
  const current = quoted && quoted.key === quoteKey ? quoted : null;
  const quote = current?.quote ?? null;
  const quoteError = current?.error ?? null;

  useEffect(() => {
    if (!quoteKey) return;
    let live = true;
    quoteRefundAction({ orderId: order.id, ticketIds: selected, speed, settledBy }).then((r) => {
      if (!live) return;
      setQuoted(r.ok ? { key: quoteKey, quote: r.data, error: null } : { key: quoteKey, quote: null, error: r.error });
    });
    return () => {
      live = false;
    };
  }, [quoteKey, order.id, selected, speed, settledBy]);

  function toggle(id: string, on: boolean) {
    setSelected((prev) => (on ? [...new Set([...prev, id])] : prev.filter((x) => x !== id)));
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const r = await requestRefundAction({ orderId: order.id, ticketIds: selected, speed, settledBy }, reason);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      onOpenChange(false);
      toast.success(r.message ?? "Refund requested");
      router.refresh();
    });
  }

  const blocked = !quote || quote.shortfallPaise > 0 || selected.length === 0 || reason.trim().length < 5;

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Request a refund</DialogTitle>
          <DialogDescription>
            Order {order.shortId} · {order.buyerName}. Morbin reviews every request. Convenience fees are never
            refunded.
          </DialogDescription>
        </DialogHeader>

        <FieldSet>
          <FieldLegend variant="label">Tickets</FieldLegend>
          <div className="space-y-2">
            {refundable.map((t) => (
              <Field key={t.id} orientation="horizontal">
                <Checkbox
                  id={`rt-${t.id}`}
                  checked={selected.includes(t.id)}
                  onCheckedChange={(v) => toggle(t.id, !!v)}
                />
                <FieldLabel htmlFor={`rt-${t.id}`} className="flex-1 font-normal">
                  <span className="font-mono text-xs">{t.code}</span>
                  <span className="text-muted-foreground">
                    {t.typeName} · {t.attendeeName}
                    {t.status === "USED" && " · already checked in"}
                  </span>
                </FieldLabel>
                <span className="text-sm tabular-nums">{formatINR(t.valuePaise)}</span>
              </Field>
            ))}
          </div>
        </FieldSet>

        <FieldSet>
          <FieldLegend variant="label">Who sends the money back?</FieldLegend>
          <RadioGroup value={settledBy} onValueChange={(v) => setSettledBy(v as typeof settledBy)}>
            <FieldLabel htmlFor="sb-morbin">
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldTitle>Morbin, via Razorpay</FieldTitle>
                  <FieldDescription>Back to the original payment method. Deducted from your unpaid balance.</FieldDescription>
                </FieldContent>
                <RadioGroupItem value="MORBIN" id="sb-morbin" />
              </Field>
            </FieldLabel>
            <FieldLabel htmlFor="sb-org">
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldTitle>We’ll refund them ourselves</FieldTitle>
                  <FieldDescription>Morbin approves each ticket; you pay the customer directly.</FieldDescription>
                </FieldContent>
                <RadioGroupItem value="ORGANISATION" id="sb-org" />
              </Field>
            </FieldLabel>
          </RadioGroup>
        </FieldSet>

        {settledBy === "MORBIN" && (
          <FieldSet>
            <FieldLegend variant="label">Speed</FieldLegend>
            <RadioGroup value={speed} onValueChange={(v) => setSpeed(v as typeof speed)} className="grid grid-cols-2">
              <FieldLabel htmlFor="sp-normal">
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldTitle>Normal</FieldTitle>
                    <FieldDescription>5–7 working days, no fee</FieldDescription>
                  </FieldContent>
                  <RadioGroupItem value="NORMAL" id="sp-normal" />
                </Field>
              </FieldLabel>
              <FieldLabel htmlFor="sp-instant">
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldTitle>Instant</FieldTitle>
                    <FieldDescription>Minutes, Razorpay fee applies</FieldDescription>
                  </FieldContent>
                  <RadioGroupItem value="INSTANT" id="sp-instant" />
                </Field>
              </FieldLabel>
            </RadioGroup>
          </FieldSet>
        )}

        {selected.length > 0 && (
          <div className="rounded-lg border p-3 text-sm">
            {!quote && !quoteError && (
              <div className="space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            )}
            {quoteError && <p className="text-destructive">{quoteError}</p>}
            {quote && (
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5">
                <dt className="text-muted-foreground">Refund to customer</dt>
                <dd className="tabular-nums">{formatINR(quote.amountPaise)}</dd>
                {settledBy === "MORBIN" && (
                  <>
                    {quote.cost.gatewayFeeSharePaise > 0 && (
                      <>
                        <dt className="text-muted-foreground">Razorpay fee not returned</dt>
                        <dd className="tabular-nums">{formatINR(quote.cost.gatewayFeeSharePaise)}</dd>
                      </>
                    )}
                    {quote.cost.instantFeePaise > 0 && (
                      <>
                        <dt className="text-muted-foreground">Instant refund fee (incl. GST)</dt>
                        <dd className="tabular-nums">
                          {formatINR(quote.cost.instantFeePaise + quote.cost.instantFeeGstPaise)}
                        </dd>
                      </>
                    )}
                    <dt className="border-t pt-1.5 font-medium">Deducted from your balance</dt>
                    <dd className="border-t pt-1.5 font-medium tabular-nums">{formatINR(quote.holdPaise)}</dd>
                    <dt className="text-muted-foreground">Your unpaid balance</dt>
                    <dd className="tabular-nums text-muted-foreground">{formatINR(quote.unsettledPaise)}</dd>
                  </>
                )}
              </dl>
            )}
          </div>
        )}
        {quote && quote.shortfallPaise > 0 && (
          <Alert variant="destructive">
            <AlertTitle>Not enough unpaid balance</AlertTitle>
            <AlertDescription>
              You’re {formatINR(quote.shortfallPaise)} short. Choose fewer tickets, normal speed, or refund them
              yourselves — or contact Morbin support.
            </AlertDescription>
          </Alert>
        )}

        <Field>
          <FieldLabel htmlFor="refund-reason">Reason</FieldLabel>
          <Textarea
            id="refund-reason"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Customer can no longer attend"
          />
        </Field>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={pending} />}>Cancel</DialogClose>
          <Button onClick={submit} disabled={pending || blocked}>
            {pending && <Spinner data-icon="inline-start" />}
            Request refund
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
