import Link from "next/link";
import { notFound } from "next/navigation";
import { IndianRupeeIcon, ReceiptIcon, ScanLineIcon, TicketIcon } from "lucide-react";
import { EventStatusCard } from "@/components/features/events/event-status-card";
import { OrdersTable } from "@/components/features/orders/orders-table";
import { TicketTypesCard } from "@/components/features/tickets/ticket-types-card";
import { StatCard, StatGrid } from "@/components/patterns/stat-card";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getEventOverview, getOrgOrderRows } from "@/lib/dashboard-data";
import { publishBlockers } from "@/lib/event-service";
import { getOrgEvent } from "@/lib/events";
import { formatCount, formatINR } from "@/lib/format";
import { requireOrgSession } from "@/lib/guards";
import { can } from "@/lib/permissions";

export default async function EventOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { org, role } = await requireOrgSession();
  const { id } = await params;
  const orgId = org._id.toString();
  const event = await getOrgEvent(id, orgId);
  if (!event) notFound();

  const canManage = can(role, "manageEvents") && org.status !== "SUSPENDED";
  const ended = event.endsAt < new Date();
  const status = event.status === "PUBLISHED" && ended ? "ENDED" : event.status;
  const [overview, blockers, recentOrders] = await Promise.all([
    getEventOverview(id, orgId),
    event.status === "DRAFT" ? publishBlockers(orgId, id) : Promise.resolve([]),
    getOrgOrderRows(orgId, { eventId: id, limit: 6 }),
  ]);
  const checkinRate =
    overview.ticketsLive > 0 ? Math.round((overview.checkedIn / overview.ticketsLive) * 100) : 0;
  const locked =
    event.status === "CANCELLED"
      ? "This event is cancelled, so ticket types can't change."
      : ended
        ? "This event has ended, so ticket types can't change."
        : null;

  return (
    <div className="space-y-6">
      <EventStatusCard
        eventId={id}
        status={status}
        blockers={blockers}
        hasBookings={overview.hasBookings}
        canManage={canManage}
      />

      <StatGrid>
        <StatCard
          label="Ticket sales"
          value={formatINR(overview.ticketSalesPaise)}
          hint="Net of refunds, excluding convenience fees"
          icon={<IndianRupeeIcon />}
        />
        <StatCard
          label="Tickets sold"
          value={`${formatCount(overview.ticketsLive)} / ${formatCount(overview.capacity)}`}
          icon={<TicketIcon />}
        />
        <StatCard
          label="Checked in"
          value={`${checkinRate}%`}
          hint={`${formatCount(overview.checkedIn)} of ${formatCount(overview.ticketsLive)}`}
          icon={<ScanLineIcon />}
        />
        <StatCard label="Orders" value={formatCount(overview.paidOrders)} icon={<ReceiptIcon />} />
      </StatGrid>

      <TicketTypesCard eventId={id} rows={overview.ticketTypes} canManage={canManage} locked={locked} />

      <Card>
        <CardHeader>
          <CardTitle>Latest orders</CardTitle>
          <CardDescription>Every booking for this event, newest first.</CardDescription>
          <CardAction>
            <Button variant="outline" size="sm" render={<Link href={`/dashboard/events/${id}/orders`} />} nativeButton={false}>
              All orders
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <OrdersTable rows={recentOrders} showEvent={false} compact />
        </CardContent>
      </Card>
    </div>
  );
}
