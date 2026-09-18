import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { createTicketOrder } from "@/lib/razorpay";
import type { Event, Order, TicketType } from "@/lib/types";

const PLATFORM_FEE_BPS = 500; // 5%

const itemSchema = z.object({
  ticketTypeId: z.string().min(1),
  quantity: z.number().int().min(1).max(10),
});

const schema = z.object({
  eventId: z.string().min(1),
  items: z.array(itemSchema).min(1).max(10),
  buyer: z.object({
    name: z.string().min(2).max(80),
    email: z.string().email(),
    phone: z.string().min(6).max(20),
  }),
  attendees: z
    .array(
      z.object({
        ticketTypeId: z.string().min(1),
        name: z.string().min(2).max(80),
        email: z.string().email(),
      }),
    )
    .max(20)
    .optional(),
});

function oid(id: string): ObjectId | null {
  try {
    return new ObjectId(id);
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid order" }, { status: 400 });

  const db = await getDb();
  const eventOid = oid(parsed.data.eventId);
  if (!eventOid) return NextResponse.json({ error: "Invalid event" }, { status: 400 });

  const event = await db.collection<Event>("events").findOne({ _id: eventOid });
  if (!event || event.status !== "PUBLISHED")
    return NextResponse.json({ error: "Event is not available" }, { status: 404 });

  const now = new Date();
  if (event.endsAt < now)
    return NextResponse.json({ error: "Event has ended" }, { status: 400 });

  // Load + validate ticket types
  const typeIds = [...new Set(parsed.data.items.map((i) => i.ticketTypeId))];
  const typeOids = typeIds.map(oid);
  if (typeOids.some((o) => !o))
    return NextResponse.json({ error: "Invalid ticket type" }, { status: 400 });
  const validOids = typeOids.filter((o): o is ObjectId => o !== null);
  const types = await db
    .collection<TicketType>("ticketTypes")
    .find({ _id: { $in: validOids } })
    .toArray();
  const byId = new Map(types.map((t) => [t._id!.toString(), t]));

  let subtotal = 0;
  const orderItems = [];
  for (const item of parsed.data.items) {
    const t = byId.get(item.ticketTypeId);
    if (!t || t.eventId !== event._id!.toString())
      return NextResponse.json({ error: "Invalid ticket type" }, { status: 400 });
    if (t.saleStartsAt && t.saleStartsAt > now)
      return NextResponse.json({ error: `Sales not open for ${t.name}` }, { status: 400 });
    if (t.saleEndsAt && t.saleEndsAt < now)
      return NextResponse.json({ error: `Sales closed for ${t.name}` }, { status: 400 });
    subtotal += t.pricePaise * item.quantity;
    orderItems.push({
      ticketTypeId: item.ticketTypeId,
      name: t.name,
      quantity: item.quantity,
      unitPricePaise: t.pricePaise,
    });
  }
  if (subtotal <= 0)
    return NextResponse.json({ error: "Invalid total" }, { status: 400 });

  // Validate attendees against items
  const qtyByType = new Map(orderItems.map((i) => [i.ticketTypeId, i.quantity]));
  const attByType = new Map<string, number>();
  for (const a of parsed.data.attendees ?? []) {
    if (!qtyByType.has(a.ticketTypeId))
      return NextResponse.json({ error: "Invalid attendee ticket" }, { status: 400 });
    attByType.set(a.ticketTypeId, (attByType.get(a.ticketTypeId) ?? 0) + 1);
  }
  for (const [typeId, count] of attByType) {
    if (count > (qtyByType.get(typeId) ?? 0))
      return NextResponse.json({ error: "Too many attendees for a ticket type" }, { status: 400 });
  }

  // Atomic inventory holds
  const holds: { id: ObjectId; qty: number }[] = [];
  try {
    for (const item of parsed.data.items) {
      const r = await db.collection("ticketTypes").updateOne(
        {
          _id: new ObjectId(item.ticketTypeId),
          $expr: { $lte: [{ $add: ["$soldCount", item.quantity] }, "$capacity"] },
        },
        { $inc: { soldCount: item.quantity } },
      );
      if (r.matchedCount === 0) throw new Error("Sold out");
      holds.push({ id: new ObjectId(item.ticketTypeId), qty: item.quantity });
    }
  } catch {
    for (const h of holds) {
      await db.collection("ticketTypes").updateOne({ _id: h.id }, { $inc: { soldCount: -h.qty } });
    }
    return NextResponse.json({ error: "Sold out" }, { status: 409 });
  }

  const platformFeePaise = Math.round((subtotal * PLATFORM_FEE_BPS) / 10000);
  const totalPaise = subtotal; // buyer pays face value; fee split from organizer share
  const organizerAmountPaise = subtotal - platformFeePaise;

  const order: Order = {
    eventId: event._id!.toString(),
    organizationId: event.organizationId,
    buyerName: parsed.data.buyer.name.trim(),
    buyerEmail: parsed.data.buyer.email.toLowerCase(),
    buyerPhone: parsed.data.buyer.phone.trim(),
    items: orderItems,
    attendees: (parsed.data.attendees ?? []).map((a) => ({
      ticketTypeId: a.ticketTypeId,
      name: a.name.trim(),
      email: a.email.toLowerCase(),
    })),
    subtotalPaise: subtotal,
    platformFeePaise,
    organizerAmountPaise,
    totalPaise,
    currency: "INR",
    razorpayOrderId: "",
    razorpayPaymentId: null,
    status: "CREATED",
    createdAt: new Date(),
    paidAt: null,
  };

  try {
    const { insertedId } = await db.collection<Order>("orders").insertOne(order);
    const rzpOrder = await createTicketOrder({
      amountPaise: totalPaise,
      receipt: insertedId.toString(),
      notes: {
        eventId: order.eventId,
        organizationId: order.organizationId,
        orderId: insertedId.toString(),
      },
    });
    await db
      .collection("orders")
      .updateOne({ _id: insertedId }, { $set: { razorpayOrderId: rzpOrder.id } });
    if (!process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID)
      throw new Error("NEXT_PUBLIC_RAZORPAY_KEY_ID is not configured");
    return NextResponse.json(
      {
        orderId: insertedId.toString(),
        razorpayOrderId: rzpOrder.id,
        keyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
        totalPaise,
      },
      { status: 201 },
    );
  } catch (error) {
    for (const h of holds) {
      await db.collection("ticketTypes").updateOne({ _id: h.id }, { $inc: { soldCount: -h.qty } });
    }
    console.error("[orders]", error);
    return NextResponse.json({ error: "Unable to create order" }, { status: 500 });
  }
}
