import Link from "next/link";
import { notFound } from "next/navigation";
import { LifeBuoyIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AdminMembers,
  DataCard,
  FeeCard,
  LedgerTable,
  OrgHeaderActions,
  OwnerCard,
} from "@/components/features/admin/org-detail";
import { IssuePayoutButton, PayoutAccountCard } from "@/components/features/payouts/admin-desk";
import { PayoutsTable } from "@/components/features/payouts/payouts-table";
import { BreadcrumbLabel } from "@/components/breadcrumb-labels";
import { DateTime, Money } from "@/components/patterns/money";
import { PageHeader } from "@/components/patterns/page-header";
import { StatCard, StatGrid } from "@/components/patterns/stat-card";
import { EmptyState } from "@/components/patterns/states";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requireAdmin } from "@/lib/admin";
import { getAdminOrgDetail } from "@/lib/admin-orgs";
import { getPayoutRows } from "@/lib/dashboard-data";
import { getTeam } from "@/lib/team";

export const metadata = { title: "Organisation" };

export default async function AdminOrgPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  const { id } = await params;
  const org = await getAdminOrgDetail(id);
  if (!org) notFound();
  const [payouts, team] = await Promise.all([getPayoutRows(id), getTeam(id, admin.id)]);

  return (
    <div className="space-y-6">
      <BreadcrumbLabel segment={id} label={org.name} />
      <PageHeader
        title={org.name}
        meta={
          <>
            <StatusBadge kind="organization" value={org.status} />
            <StatusBadge kind="paymentAccount" value={org.paymentAccountStatus} />
          </>
        }
        description={`${org.events.length} event${org.events.length === 1 ? "" : "s"} · ${team.members.length} ${team.members.length === 1 ? "person" : "people"}`}
        actions={<OrgHeaderActions org={org} />}
      />

      {org.status === "SUSPENDED" && (
        <Alert variant="destructive">
          <AlertTitle>Suspended</AlertTitle>
          <AlertDescription>Tickets already sold still scan, but nothing can be published or sold.</AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="money">Money</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="events">Events</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 grid gap-4 lg:grid-cols-2">
          <OwnerCard org={org} />
          <div className="space-y-4">
            <FeeCard org={org} />
            <DataCard org={org} />
          </div>
        </TabsContent>

        <TabsContent value="money" className="mt-4 space-y-4">
          <StatGrid>
            <StatCard
              label="Unpaid balance"
              value={<Money paise={org.balance.unsettledPaise} />}
              hint={org.balance.unsettledPaise > 0 ? <IssuePayoutButton organizationId={org.id} organizationName={org.name} /> : undefined}
            />
            <StatCard label="In a draft payout" value={<Money paise={org.balance.inDraftPaise} />} />
            <StatCard label="Paid out" value={<Money paise={org.balance.paidOutPaise} />} />
            <StatCard label="Fees earned (unsettled)" value={<Money paise={-org.balance.unsettled.feesPaise} />} />
          </StatGrid>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
            <Card>
              <CardHeader>
                <CardTitle>Latest ledger entries</CardTitle>
              </CardHeader>
              <CardContent>
                <LedgerTable org={org} />
              </CardContent>
            </Card>
            <PayoutAccountCard organizationId={org.id} account={org.account} />
          </div>
          <PayoutsTable rows={payouts} basePath="/dashboard/admin/payouts" />
        </TabsContent>

        <TabsContent value="members" className="mt-4">
          <AdminMembers organizationId={org.id} members={team.members} invites={team.invites} />
        </TabsContent>

        <TabsContent value="events" className="mt-4">
          {org.events.length === 0 ? (
            <EmptyState title="No events yet" description="Events this organisation creates appear here." />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead>Event</TableHead>
                    <TableHead>Starts</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-0" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {org.events.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="font-medium">{e.title}</TableCell>
                      <TableCell>
                        <DateTime value={e.startsAt} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge kind="event" value={e.status} />
                      </TableCell>
                      <TableCell>
                        <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/dashboard/events/${e.id}`} />}>
                          <LifeBuoyIcon data-icon="inline-start" />
                          Open as support
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
