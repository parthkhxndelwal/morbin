import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getEventById, getTicketTypes } from "@/lib/events";
import { getOrgByOwner } from "@/lib/organizations";
import type { Order, Ticket } from "@/lib/types";
import { CheckinBox, PublishBar, TicketTypeForm } from "./controls";

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth");
  const { id } = await params;
  const org = await getOrgByOwner(session.user.id);
  const event = await getEventById(id);
  if (!event || !org?._id || event.organizationId !== org._id.toString()) notFound();

  const db = await getDb();
  const [types, tickets, totals] = await Promise.all([
    getTicketTypes(event._id!.toString()),
    db
      .collection<Ticket>("tickets")
      .find({ eventId: event._id!.toString(), status: { $in: ["VALID", "USED"] } })
      .sort({ _id: -1 })
      .limit(200)
      .toArray(),
    Promise.all([
      db
        .collection<Order>("orders")
        .aggregate<{ revenue: number }>([
          { $match: { eventId: event._id!.toString(), status: "PAID" } },
          { $group: { _id: null, revenue: { $sum: "$totalPaise" } } },
        ])
        .toArray(),
      db
        .collection<Ticket>("tickets")
        .countDocuments({
          eventId: event._id!.toString(),
          status: { $in: ["VALID", "USED"] },
        }),
    ]),
  ]);
  const revenue = totals[0][0]?.revenue ?? 0;
  const ticketCount = totals[1];

  return (
    <div>
      <Link href="/dashboard/events" className="text-sm text-neutral-400 hover:text-white">
        Ã¢â€ Â Events
      </Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{event.title}</h1>
          <p className="mt-1 text-sm text-neutral-400">
            {event.venue} Ã‚Â· Revenue Ã¢â€šÂ¹{(revenue / 100).toFixed(0)} Ã‚Â· {ticketCount} tickets
          </p>
          {event.status === "PUBLISHED" && (
            <p className="mt-1 text-sm">
              Public link:{" "}
              <Link href={`/e/${event.slug}`} className="text-violet-300 underline">
                /e/{event.slug}
              </Link>
            </p>
          )}
        </div>
        <PublishBar eventId={event._id!.toString()} status={event.status} />
      </div>

      <h2 className="mt-8 text-sm font-bold uppercase tracking-widest text-neutral-400">
        Ticket types
      </h2>
      <div className="mt-3 space-y-2">
        {types.map((t) => (
          <div
            key={t._id!.toString()}
            className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm"
          >
            <span className="font-semibold">{t.name}</span>
            <span className="text-neutral-400">
              Ã¢â€šÂ¹{(t.pricePaise / 100).toFixed(0)} Ã‚Â· {t.soldCount}/{t.capacity} sold
            </span>
          </div>
        ))}
        {types.length === 0 && (
          <p className="text-sm text-neutral-500">No ticket types yet.</p>
        )}
      </div>
      {event.status === "DRAFT" && (
        <div className="mt-3">
          <TicketTypeForm eventId={event._id!.toString()} />
        </div>
      )}

      <h2 className="mt-8 text-sm font-bold uppercase tracking-widest text-neutral-400">
        Door check-in
      </h2>
      <div className="mt-3">
        <CheckinBox />
      </div>

      <h2 className="mt-8 text-sm font-bold uppercase tracking-widest text-neutral-400">
        Attendees ({ticketCount}{ticketCount > tickets.length ? ` Ã‚Â· showing recent ${tickets.length}` : ""})
      </h2>
      <div className="mt-3 max-h-96 overflow-auto rounded-2xl border border-white/10">        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#0b0b1c]">
            <tr className="text-left text-neutral-400">
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Code</th>
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((t) => (
              <tr key={t._id!.toString()} className="border-t border-white/5">
                <td className="px-4 py-2">{t.attendeeName}</td>
                <td className="px-4 py-2 font-mono text-xs text-neutral-400">{t.code}</td>
                <td className="px-4 py-2">{t.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
