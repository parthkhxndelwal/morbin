import Link from "next/link";
import { ChevronRightIcon } from "lucide-react";
import { Money } from "@/components/patterns/money";
import { PageHeader } from "@/components/patterns/page-header";
import { StatCard, StatGrid } from "@/components/patterns/stat-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdmin } from "@/lib/admin";
import { getPlatformOverview } from "@/lib/admin-desk";

export const metadata = { title: "Overview" };

/** The admin home: platform totals, and everything waiting on Morbin. */
export default async function AdminOverviewPage() {
  await requireAdmin();
  const o = await getPlatformOverview();
  const todo = [
    { n: o.waiting.applications, label: "applications to review", href: "/dashboard/admin/applications" },
    { n: o.waiting.refunds, label: "refunds awaiting approval", href: "/dashboard/admin/refunds" },
    { n: o.waiting.failedRefunds, label: "refunds failed at Razorpay", href: "/dashboard/admin/refunds", urgent: true },
    { n: o.waiting.overdueDataRequests, label: "data requests due within a week", href: "/dashboard/admin/privacy", urgent: true },
    { n: o.waiting.dataRequests - o.waiting.overdueDataRequests, label: "data requests to answer", href: "/dashboard/admin/privacy" },
    { n: o.waiting.payoutQueries, label: "payout queries to answer", href: "/dashboard/admin/payouts" },
    { n: o.orgs.unverified, label: "organisations not verified for payments", href: "/dashboard/admin/orgs" },
    { n: o.waiting.failedEmails, label: "emails that couldn't be delivered", href: "/dashboard/admin/audit", urgent: true },
  ].filter((t) => t.n > 0);

  return (
    <div className="space-y-6">
      <PageHeader title="Overview" description="How Morbin is doing, and what needs you." />
      <StatGrid>
        <StatCard
          label="Ticket sales, 30 days"
          value={<Money paise={o.ticketSales30dPaise} />}
          hint={
            <>
              <Money paise={o.ticketSalesAllPaise} /> all time, net of refunds
            </>
          }
        />
        <StatCard
          label="Fee revenue, 30 days"
          value={<Money paise={o.feeRevenue30dPaise} />}
          hint={
            <>
              <Money paise={o.feeRevenueAllPaise} /> all time, excluding GST
            </>
          }
        />
        <StatCard
          label="Owed to organisations"
          value={<Money paise={o.owedToOrgsPaise + o.inDraftPayoutsPaise} />}
          hint={
            <>
              <Money paise={o.inDraftPayoutsPaise} /> already in draft payouts
            </>
          }
        />
        <StatCard
          label="Organisations"
          value={o.orgs.active}
          hint={o.orgs.suspended ? `${o.orgs.suspended} suspended` : "None suspended"}
        />
      </StatGrid>
      <Card>
        <CardHeader>
          <CardTitle>Needs attention</CardTitle>
          <CardDescription>{todo.length ? "Waiting on Morbin." : "Nothing is waiting on you."}</CardDescription>
        </CardHeader>
        {todo.length > 0 && (
          <CardContent>
            <ul className="divide-y rounded-lg border">
              {todo.map((t) => (
                <li key={t.label}>
                  <Link href={t.href} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted/50">
                    <Badge variant={t.urgent ? "destructive" : "secondary"} className="tabular-nums">
                      {t.n}
                    </Badge>
                    <span className="flex-1">{t.label}</span>
                    <ChevronRightIcon className="size-4 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
