import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getEventById, getTicketTypes, updateEvent } from "@/lib/events";
import { getOrgByOwner } from "@/lib/organizations";

const patchSchema = z.object({
  title: z.string().min(3).max(120).optional(),
  description: z.string().min(10).max(5000).optional(),
  venue: z.string().min(2).max(200).optional(),
  timezone: z.string().min(1).max(60).optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "CANCELLED"]).optional(),
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
  const ticketTypes = await getTicketTypes(event._id!.toString());
  return NextResponse.json({
    event: { ...event, id: event._id!.toString() },
    ticketTypes: ticketTypes.map((t) => ({ ...t, id: t._id!.toString() })),
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid update" }, { status: 400 });
  const org = await getOrgByOwner(session.user.id);
  const event = await getEventById(id);
  if (!event || !org?._id || event.organizationId !== org._id.toString())
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Publishing a paid event requires a verified Razorpay account.
  if (parsed.data.status === "PUBLISHED" && org.paymentAccountStatus !== "VERIFIED") {
    const types = await getTicketTypes(event._id!.toString());
    const hasPaid = types.some((t) => t.pricePaise > 0);
    if (hasPaid)
      return NextResponse.json(
        { error: "Verify your Razorpay account before publishing paid events" },
        { status: 403 },
      );
  }

  const patch: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.startsAt) patch.startsAt = new Date(parsed.data.startsAt);
  if (parsed.data.endsAt) patch.endsAt = new Date(parsed.data.endsAt);
  const ok = await updateEvent(id, org._id.toString(), patch as never);
  if (!ok) return NextResponse.json({ error: "Update failed" }, { status: 400 });
  return NextResponse.json({ ok: true });
}
