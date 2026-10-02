import { can } from "@/lib/permissions";
import { NoAccessState } from "@/components/patterns/states";
import { Money } from "@/components/patterns/money";
import { EmptyState } from "@/components/patterns/states";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getDb } from "@/lib/db";
import { getActiveFlow } from "@/lib/flows";
import { formatCount } from "@/lib/format";
import { requireEventAccess } from "@/lib/event-access";
import { ORDER_NET_TICKET_VALUE, SOLD_ORDER_STATUSES } from "@/lib/dashboard-data";
import type { Order, Ticket } from "@/lib/types";

export const metadata = { title: "Insights" };

/** Human labels for the stored identity-method values. */
const IDENTITY_LABELS: Record<string, string> = {
  GOOGLE: "Google",
  EMAIL_OTP: "Email one-time link",
};

/**
 * Who bought, and how they proved it.
 *
 * Answers the question a student-only event actually raises: how many came
 * through each audience, and how many verified by domain link versus Google. It
 * reads `flowBranch` off the tickets, which is denormalised at fulfillment
 * precisely so this stays a straightforward aggregation.
 */
export default async function InsightsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { role, event } = await requireEventAccess(id);
  if (!can(role, "view")) {
    return <NoAccessState description="Morbin support works on an event's setup and doesn't see its buyers' details." />;
  }
  const eventId = event._id!.toString();

  const db = await getDb();
  const flow = await getActiveFlow(eventId);

  // Human labels for the stored branch values.
  const labels = new Map<string, string>();
  for (const step of flow.steps) {
    for (const o of step.options ?? []) labels.set(o.value, o.label);
  }

  const [branchRows, methodRows, utmRows] = await Promise.all([
    db
      .collection<Ticket>("tickets")
      .aggregate<{ _id: string | null; tickets: number; people: number }>([
        { $match: { eventId, status: { $in: ["VALID", "USED"] } } },
        {
          $group: {
            _id: "$flowBranch",
            tickets: { $sum: 1 },
            people: { $addToSet: "$attendeeEmail" },
          },
        },
        { $project: { _id: 1, tickets: 1, people: { $size: "$people" } } },
        { $sort: { tickets: -1 } },
      ])
      .toArray(),
    db
      .collection<Order>("orders")
      .aggregate<{ _id: string | null; orders: number; revenue: number }>([
        { $match: { eventId, status: { $in: SOLD_ORDER_STATUSES } } },
        {
          $group: {
            _id: "$identityMethod",
            orders: { $sum: 1 },
            revenue: { $sum: ORDER_NET_TICKET_VALUE },
          },
        },
        { $sort: { revenue: -1 } },
      ])
      .toArray(),
    db
      .collection<Order>("orders")
      .aggregate<{ _id: string | null; orders: number; revenue: number }>([
        { $match: { eventId, status: { $in: SOLD_ORDER_STATUSES } } },
        { $group: { _id: "$utm.source", orders: { $sum: 1 }, revenue: { $sum: ORDER_NET_TICKET_VALUE } } },
        { $sort: { orders: -1 } },
        { $limit: 12 },
      ])
      .toArray(),
  ]);

  const anyBranchData = branchRows.some((r) => r._id !== null);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Who bought</CardTitle>
          <CardDescription>
            How many people came through each audience, and how many tickets they hold.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {branchRows.length === 0 ? (
            <EmptyState
              title="No tickets sold yet"
              description="Audiences are grouped here as soon as someone books."
            />
          ) : !anyBranchData ? (
            <Card size="sm" className="bg-muted/40">
              <CardHeader>
                <CardDescription>
                  Tickets sold before this event had booking rules carry no group, so they
                  can&apos;t be grouped here. New sales are grouped automatically.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead>Audience</TableHead>
                    <TableHead>People</TableHead>
                    <TableHead>Tickets</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {branchRows.map((r) => (
                    <TableRow key={r._id ?? "none"}>
                      <TableCell>
                        {r._id ? (
                          <span className="font-medium">{labels.get(r._id) ?? r._id}</span>
                        ) : (
                          <Badge variant="outline">No audience set</Badge>
                        )}
                      </TableCell>
                      <TableCell className="tabular-nums">{formatCount(r.people)}</TableCell>
                      <TableCell className="tabular-nums">{formatCount(r.tickets)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How they confirmed</CardTitle>
          <CardDescription>
            How each buyer proved who they were, and the revenue each method brought in.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {methodRows.length === 0 ? (
            <EmptyState
              title="Nothing confirmed yet"
              description="Methods are grouped here as soon as an order is paid."
            />
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead>Method</TableHead>
                    <TableHead>Orders</TableHead>
                    <TableHead>Revenue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {methodRows.map((r) => (
                    <TableRow key={r._id ?? "none"}>
                      <TableCell>
                        {r._id && IDENTITY_LABELS[r._id] ? (
                          <Badge variant="secondary">{IDENTITY_LABELS[r._id]}</Badge>
                        ) : (
                          <Badge variant="outline">No confirmation</Badge>
                        )}
                      </TableCell>
                      <TableCell className="tabular-nums">{formatCount(r.orders)}</TableCell>
                      <TableCell>
                        <Money paise={r.revenue} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Where they came from</CardTitle>
          <CardDescription>
            The top sources carried on your links, with the revenue each brought in.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {utmRows.length === 0 ? (
            <EmptyState
              title="No campaign data yet"
              description="Links shared with a ?utm_source= parameter are grouped here — that is how a QR code on a poster gets attributed."
            />
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead>Source</TableHead>
                    <TableHead>Orders</TableHead>
                    <TableHead>Revenue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {utmRows.map((r) => (
                    <TableRow key={r._id ?? "direct"}>
                      <TableCell className="font-medium">{r._id ?? "direct (no utm)"}</TableCell>
                      <TableCell className="tabular-nums">{formatCount(r.orders)}</TableCell>
                      <TableCell>
                        <Money paise={r.revenue} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
