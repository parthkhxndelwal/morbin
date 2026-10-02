import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { CHECKOUT_COOKIE, getSessionByResumeToken } from "@/lib/checkout";
import { getDb, toObjectId } from "@/lib/db";
import { ticketQrSvg } from "@/lib/tickets";
import type { Order, Ticket } from "@/lib/types";

/**
 * GET — the tickets this drawer just booked, so the buyer sees them the moment
 * the order is paid, without signing in. Scoped to the checkout session cookie
 * (whoever holds it is the person who just booked); 404 for anything else.
 */
export async function GET() {
  const jar = await cookies();
  const session = await getSessionByResumeToken(jar.get(CHECKOUT_COOKIE)?.value);
  const orderId = session?.orderId ? toObjectId(session.orderId) : null;
  if (!session || !orderId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const db = await getDb();
  const order = await db.collection<Order>("orders").findOne({ _id: orderId, checkoutSessionId: session.publicId });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (order.status !== "PAID") return NextResponse.json({ status: order.status, tickets: [] });
  const tickets = await db.collection<Ticket>("tickets").find({ orderId: session.orderId!, status: "VALID" }).toArray();
  return NextResponse.json(
    {
      status: order.status,
      tickets: await Promise.all(
        tickets.map(async (t) => ({
          code: t.code,
          attendeeName: t.attendeeName,
          type: order.items.find((i) => i.ticketTypeId === t.ticketTypeId)?.name ?? "Ticket",
          qrSvg: await ticketQrSvg(t.qrPayload),
        })),
      ),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
