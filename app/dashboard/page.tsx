import Link from "next/link";
import { CalendarDaysIcon, IndianRupeeIcon, ScanLineIcon, TicketIcon } from "lucide-react";
import { NewEventButton } from "@/components/features/events/new-event-button";
import { OrdersTable } from "@/components/features/orders/orders-table";
import { SalesChart } from "@/components/features/overview/sales-chart";
import { PageHeader } from "@/components/patterns/page-header";
import { StatCard, StatGrid } from "@/components/patterns/stat-card";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getOrgOrderRows, getOrgOverview } from "@/lib/dashboard-data";
import { formatCount, formatINR } from "@/lib/format";
import { requireOrgSession } from "@/lib/guards";
import { can, capabilitySummary, memberLabel } from "@/lib/permissions";

export const metadata = { title: "Overview" };

export default async function DashboardPage() {
  const { org, role } = await requireOrgSession();
  const orgId = org._id.toString();
  const canManage = can(role, "manageEvents");
  const [overview, recentOrders] = await Promise.all([
    getOrgOverview(orgId),
    getOrgOrderRows(orgId, { limit: 8, statuses: ["PAID", "REFUNDED"] }),
  ]);
  const checkinRate =
    overview.ticketsIssued > 0 ? Math.round((overview.checkedIn / overview.ticketsIssued) * 100) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={org.name}
        meta={<StatusBadge kind="paymentAccount" value={org.paymentAccountStatus} />}
        description={
          canManage
            ? "Sales, tickets and check-ins across all your events."
            : `${memberLabel(org.type ?? "EVENT")} access — ${capabilitySummary(role)}`
        }
        actions={
          <>
            <Button variant="outline" render={<Link href="/dashboard/scan" />} nativeButton={false}>
              <ScanLineIcon data-icon="inline-start" />
              Check-in desk
            </Button>
            {canManage && <NewEventButton />}
          </>
        }
      />

      {org.paymentAccountStatus !== "VERIFIED" && (
        <Alert>
          <IndianRupeeIcon />
          <AlertTitle>Paid tickets unlock after verification</AlertTitle>
          <AlertDescription>
            Morbin is reviewing your organisation. You can create events and sell free tickets
            meanwhile.
          </AlertDescription>
        </Alert>
      )}

      <StatGrid>
        <StatCard
          label="Ticket sales"
          value={formatINR(overview.grossPaise)}
          hint={`${formatCount(overview.paidOrders)} paid orders`}
          icon={<IndianRupeeIcon />}
        />
        <StatCard
          label="Tickets issued"
          value={formatCount(overview.ticketsIssued)}
          icon={<TicketIcon />}
        />
        <StatCard
          label="Checked in"
          value={`${checkinRate}%`}
          hint={`${formatCount(overview.checkedIn)} of ${formatCount(overview.ticketsIssued)}`}
          icon={<ScanLineIcon />}
        />
        <StatCard
          label="Upcoming events"
          value={formatCount(overview.upcomingEvents)}
          icon={<CalendarDaysIcon />}
        />
      </StatGrid>

      <SalesChart data={overview.dailySales} />

      <Card>
        <CardHeader>
          <CardTitle>Recent orders</CardTitle>
          <CardDescription>The latest paid and refunded orders across your events.</CardDescription>
        </CardHeader>
        <CardContent>
          <OrdersTable rows={recentOrders} compact />
        </CardContent>
      </Card>
    </div>
  );
}
