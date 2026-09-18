import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getOrgEvents } from "@/lib/events";
import { getOrgByOwner } from "@/lib/organizations";
import type { Order } from "@/lib/types";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const org = await getOrgByOwner(session.user.id);
  if (!org || !org._id) redirect("/onboarding");
  const orgId = org._id.toString();

  const db = await getDb();
  const [events, paidOrders, recentOrders] = await Promise.all([
    getOrgEvents(orgId),
    db.collection<Order>("orders").find({ organizationId: orgId, status: "PAID" }).toArray(),
    db
      .collection<Order>("orders")
      .find({ organizationId: orgId, status: "PAID" })
      .sort({ paidAt: -1 })
      .limit(8)
      .toArray(),
  ]);
  const revenue = paidOrders.reduce((s, o) => s + o.totalPaise, 0);
  const ticketsSold = paidOrders.reduce(
    (s, o) => s + o.items.reduce((a, i) => a + i.quantity, 0),
    0,
  );

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">{org.name}</h1>
      <p className="mt-1 text-sm text-neutral-400">
        Payment status:{" "}
        <span
          className={
            org.paymentAccountStatus === "VERIFIED" ? "text-emerald-300" : "text-amber-300"
          }
        >
          {org.paymentAccountStatus}
        </span>
        {org.paymentAccountStatus !== "VERIFIED" && (
          <>
            {" · "}
            <Link href="/onboarding" className="underline">
              Finish verification
            </Link>
          </>
        )}
      </p>
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {[
          ["Revenue", `₹${(revenue / 100).toFixed(0)}`],
          ["Tickets sold", String(ticketsSold)],
          ["Events", String(events.length)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <p className="text-xs uppercase tracking-widest text-neutral-400">{label}</p>
            <p className="mt-1 text-2xl font-bold">{value}</p>
          </div>
        ))}
      </div>
      <div className="mt-6 flex gap-3">
        <Link
          href="/dashboard/events"
          className="rounded-full bg-white px-5 py-2.5 text-sm font-bold text-neutral-950 hover:bg-violet-200"
        >
          Manage events
        </Link>
        <Link
          href="/verify"
          className="rounded-full border border-white/15 px-5 py-2.5 text-sm font-semibold hover:bg-white/10"
        >
          Check-in desk
        </Link>
      </div>
      <h2 className="mt-10 text-sm font-bold uppercase tracking-widest text-neutral-400">
        Recent orders
      </h2>
      <div className="mt-3 overflow-x-auto rounded-2xl border border-white/10">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left text-neutral-400">
              <th className="px-4 py-3 font-medium">Buyer</th>
              <th className="px-4 py-3 font-medium">Tickets</th>
              <th className="px-4 py-3 font-medium">Amount</th>
              <th className="px-4 py-3 font-medium">Transfer</th>
            </tr>
          </thead>
          <tbody>
            {recentOrders.map((o) => (
              <tr key={o._id!.toString()} className="border-b border-white/5 last:border-0">
                <td className="px-4 py-3">{o.buyerName}</td>
                <td className="px-4 py-3 text-neutral-400">
                  {o.items.reduce((s, i) => s + i.quantity, 0)}
                </td>
                <td className="px-4 py-3">₹{(o.totalPaise / 100).toFixed(0)}</td>
                <td className="px-4 py-3 text-neutral-400">{o.transferStatus ?? "—"}</td>
              </tr>
            ))}
            {recentOrders.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-neutral-500">
                  No orders yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
