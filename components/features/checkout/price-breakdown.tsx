import { Money } from "@/components/patterns/money";
import { Separator } from "@/components/ui/separator";
import type { CheckoutPricing } from "./types";

/**
 * The order's price, exactly as the order route will charge it.
 *
 * When the customer pays the convenience fee it's shown BookMyShow-style: the
 * fee, then its base amount and GST. Only "GST" appears here — the CGST/SGST
 * split is for the invoice. When the organiser absorbs the fee, no fee lines
 * are shown at all.
 */
export function PriceBreakdown({ pricing }: { pricing: CheckoutPricing }) {
  const q = pricing.quote;
  const customerPays = pricing.bearer === "CUSTOMER" && q.feePaise > 0;
  return (
    <div className="space-y-2 text-sm" aria-label="Price breakdown">
      <Line label="Ticket(s)" paise={q.ticketTotalPaise} />
      {customerPays && (
        <>
          <Line label="Convenience fees" paise={q.feePaise} />
          <Line label="Base amount" paise={q.feeBasePaise} sub />
          <Line label="GST" paise={q.feeGstPaise} sub />
        </>
      )}
      <Separator />
      <Line label="Total" paise={q.orderTotalPaise} strong />
      {customerPays && <p className="text-xs text-muted-foreground">Convenience fees are non-refundable.</p>}
    </div>
  );
}

function Line({ label, paise, sub, strong }: { label: string; paise: number; sub?: boolean; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 ${sub ? "pl-4 text-muted-foreground" : ""} ${strong ? "font-semibold" : ""}`}>
      <span>{label}</span>
      <Money paise={paise} />
    </div>
  );
}
