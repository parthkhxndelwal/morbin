import { FileTextIcon, ReceiptTextIcon, SheetIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { DateTime, Money } from "@/components/patterns/money";
import type { PayoutDetail } from "@/lib/dashboard-data";

function Line({ label, paise, strong }: { label: string; paise: number; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 text-sm ${strong ? "font-semibold" : ""}`}>
      <span className={strong ? "" : "text-muted-foreground"}>{label}</span>
      <Money paise={paise} signed={!strong && paise > 0 && label === "Adjustments"} />
    </div>
  );
}

/** Totals, documents and the query thread for one payout. Shared by owner and admin views. */
export function PayoutSummary({ payout }: { payout: PayoutDetail }) {
  const t = payout.totals;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Breakdown</CardTitle>
          <CardDescription>
            Everything recorded up to <DateTime value={payout.cutoffAt} />.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Line label="Ticket sales" paise={t.salesPaise} />
          <Line label="Platform fees" paise={t.feesPaise} />
          <Line label="Refunds" paise={t.refundsPaise} />
          <Line label="Refund costs" paise={t.refundCostsPaise} />
          <Line label="Adjustments" paise={t.adjustmentsPaise} />
          <Separator />
          <Line label="Net payout" paise={t.netPaise} strong />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Transfer</CardTitle>
          <CardDescription>{payout.note ?? "Bank transfer details and documents."}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">UTR / reference</span>
            <span className="font-mono">{payout.bankReference ?? "—"}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Transferred</span>
            <DateTime value={payout.transferredAt} />
          </div>
          {payout.acknowledgedAt && (
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Acknowledged</span>
              <DateTime value={payout.acknowledgedAt} />
            </div>
          )}
          <div className="flex flex-wrap gap-2 pt-2">
            {payout.statementDocId && (
              <Button variant="outline" size="sm" nativeButton={false} render={<a href={`/api/documents/${payout.statementDocId}`} />}>
                <FileTextIcon data-icon="inline-start" />
                Statement (PDF)
              </Button>
            )}
            {payout.breakdownDocId && (
              <Button variant="outline" size="sm" nativeButton={false} render={<a href={`/api/documents/${payout.breakdownDocId}`} />}>
                <SheetIcon data-icon="inline-start" />
                Line items (CSV)
              </Button>
            )}
            {payout.invoiceDocId && (
              <Button variant="outline" size="sm" nativeButton={false} render={<a href={`/api/documents/${payout.invoiceDocId}`} />}>
                <ReceiptTextIcon data-icon="inline-start" />
                Invoice (PDF)
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function PayoutThread({ payout }: { payout: PayoutDetail }) {
  if (payout.messages.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Conversation</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {payout.messages.map((m) => (
          <div key={m.id} className="space-y-1">
            <p className="text-xs text-muted-foreground">
              {m.authorRole === "ADMIN" ? "Morbin" : "Organisation"} · <DateTime value={m.createdAt} mode="relative" />
            </p>
            <p className="text-sm whitespace-pre-wrap">{m.message}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
