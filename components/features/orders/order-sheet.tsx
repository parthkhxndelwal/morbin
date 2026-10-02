"use client";

import { Undo2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { DateTime, Money } from "@/components/patterns/money";
import { ErrorState } from "@/components/patterns/states";
import { StatusBadge } from "@/components/patterns/status-badge";
import type { OrderDetail } from "@/lib/order-detail";
import { getOrderDetailAction } from "./actions";
import { RefundRequestDialog } from "./refund-request-dialog";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

/** Everything about one order, with refund requests for owners. */
export function OrderSheet({
  orderId,
  onClose,
  canRefund,
}: {
  orderId: string | null;
  onClose: () => void;
  canRefund: boolean;
}) {
  const [refundOpen, setRefundOpen] = useState(false);
  const [reload, setReload] = useState(0);
  // The fetched result is tagged with what it was fetched for, so switching
  // orders shows the loading state straight away instead of the previous order.
  const [loaded, setLoaded] = useState<{ key: string; order: OrderDetail | null; error: string | null } | null>(
    null,
  );
  const key = `${orderId}:${reload}`;
  const current = loaded?.key === key ? loaded : null;
  const order = current?.order ?? null;
  const error = current?.error ?? null;

  useEffect(() => {
    if (!orderId) return;
    let live = true;
    getOrderDetailAction(orderId).then((r) => {
      if (!live) return;
      setLoaded(r.ok ? { key, order: r.data, error: null } : { key, order: null, error: r.error });
    });
    return () => {
      live = false;
    };
  }, [orderId, key]);

  const refundable =
    order &&
    (order.status === "PAID" || order.status === "PARTIALLY_REFUNDED") &&
    order.tickets.some((t) => t.status !== "REFUNDED" && !t.refundCaseId);

  return (
    <Sheet open={!!orderId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{order ? `Order ${order.shortId}` : "Order"}</SheetTitle>
          <SheetDescription>{order?.eventTitle ?? "Loading…"}</SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 px-4">
          {!order && !error && (
            <div className="space-y-3">
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-24 w-full" />
            </div>
          )}
          {error && <ErrorState description={error} />}
          {order && (
            <>
              <div className="space-y-2">
                <Row label="Status">
                  <StatusBadge kind="order" value={order.status} />
                </Row>
                <Row label="Buyer">
                  <span className="block">{order.buyerName}</span>
                  <span className="block text-xs text-muted-foreground">{order.buyerEmail}</span>
                </Row>
                <Row label="Placed">
                  <DateTime value={order.createdAt} />
                </Row>
                {order.audience && <Row label="Audience">{order.audience}</Row>}
                {order.identityMethod && (
                  <Row label="Verified via">{order.identityMethod === "EMAIL_OTP" ? "Email link" : "Google"}</Row>
                )}
                {order.utm?.source && (
                  <Row label="Source">
                    {[order.utm.source, order.utm.medium, order.utm.campaign].filter(Boolean).join(" / ")}
                  </Row>
                )}
              </div>
              <Separator />
              <div className="space-y-2">
                <Row label="Tickets">
                  <Money paise={order.pricing.ticketTotalPaise} />
                </Row>
                {order.pricing.feePaise > 0 && (
                  <Row
                    label={order.pricing.feeBearer === "CUSTOMER" ? "Convenience fee (paid by buyer)" : "Morbin fee (absorbed)"}
                  >
                    <Money paise={order.pricing.feePaise} />
                  </Row>
                )}
                <Row label="Buyer paid">
                  <Money paise={order.pricing.orderTotalPaise} className="font-medium" />
                </Row>
                <Row label="Your share">
                  <Money paise={order.pricing.organiserNetPaise} />
                </Row>
                {order.pricing.refundedPaise > 0 && (
                  <Row label="Refunded">
                    <Money paise={-order.pricing.refundedPaise} />
                  </Row>
                )}
              </div>
              <Separator />
              <div className="space-y-2">
                <p className="text-sm font-medium">Tickets</p>
                {order.tickets.map((t) => (
                  <div key={t.id} className="flex items-start justify-between gap-3 rounded-lg border p-2.5 text-sm">
                    <div className="min-w-0">
                      <p className="font-mono text-xs">{t.code}</p>
                      <p className="truncate">
                        {t.attendeeName} <span className="text-muted-foreground">· {t.typeName}</span>
                      </p>
                    </div>
                    <StatusBadge kind="ticket" value={t.refundCaseId && t.status !== "REFUNDED" ? "REFUND_PENDING" : t.status} />
                  </div>
                ))}
              </div>
              {order.answers.length > 0 && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Answers</p>
                    {order.answers.map((a) => (
                      <Row key={a.label} label={a.label}>
                        {a.value}
                      </Row>
                    ))}
                  </div>
                </>
              )}
              {order.refunds.length > 0 && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Refunds</p>
                    {order.refunds.map((r) => (
                      <div key={r.id} className="flex items-center justify-between gap-2 text-sm">
                        <span>
                          <Money paise={r.amountPaise} /> · {r.tickets} ticket{r.tickets === 1 ? "" : "s"}
                        </span>
                        <StatusBadge kind="refund" value={r.status} />
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {order && canRefund && refundable && (
          <SheetFooter>
            <Button variant="outline" onClick={() => setRefundOpen(true)}>
              <Undo2Icon data-icon="inline-start" />
              Request refund
            </Button>
          </SheetFooter>
        )}
        {order && refundOpen && (
          <RefundRequestDialog
            order={order}
            open={refundOpen}
            onOpenChange={(o) => {
              setRefundOpen(o);
              if (!o) setReload((n) => n + 1);
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
