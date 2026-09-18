import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { createTicketType, getEventById, getTicketTypes } from "@/lib/events";
import { getOrgByOwner } from "@/lib/organizations";

const schema = z.object({
  name: z.string().min(2).max(80),
  description: z.string().max(500).default(""),
  pricePaise: z.number().int().min(0).max(100000000),
  capacity: z.number().int().min(1).max(1000000),
  saleStartsAt: z.string().datetime().optional(),
  saleEndsAt: z.string().datetime().optional(),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const org = await getOrgByOwner(session.user.id);
  const event = await getEventById(id);
  if (!event || !org?._id || event.organizationId !== org._id.toString())
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const types = await getTicketTypes(event._id!.toString());
  return NextResponse.json({
    ticketTypes: types.map((t) => ({ ...t, id: t._id!.toString() })),
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid ticket type" }, { status: 400 });
  const org = await getOrgByOwner(session.user.id);
  const event = await getEventById(id);
  if (!event || !org?._id || event.organizationId !== org._id.toString())
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (event.status !== "DRAFT")
    return NextResponse.json(
      { error: "Ticket types can only be edited while the event is a draft" },
      { status: 400 },
    );
  const tt = await createTicketType(event._id!.toString(), {
    name: parsed.data.name,
    description: parsed.data.description,
    pricePaise: parsed.data.pricePaise,
    capacity: parsed.data.capacity,
    saleStartsAt: parsed.data.saleStartsAt ? new Date(parsed.data.saleStartsAt) : null,
    saleEndsAt: parsed.data.saleEndsAt ? new Date(parsed.data.saleEndsAt) : null,
  });
  return NextResponse.json(
    { ticketType: { ...tt, id: tt._id!.toString() } },
    { status: 201 },
  );
}
