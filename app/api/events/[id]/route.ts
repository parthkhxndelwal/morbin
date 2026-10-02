import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getEventById, getTicketTypes, updateEvent, updateEventSlug } from "@/lib/events";
import { getOrgForUser } from "@/lib/organizations";
import { can } from "@/lib/permissions";

const patchSchema = z.object({
  title: z.string().min(3).max(120).optional(),
  description: z.string().min(10).max(5000).optional(),
  venue: z.string().min(2).max(200).optional(),
  timezone: z.string().min(1).max(60).optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "CANCELLED"]).optional(),
  // The public URL. Handled apart from the rest because it is validated for
  // shape *and* global uniqueness — a bad value must never take the page down.
  slug: z.string().min(1).max(80).optional(),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  // Any member may read their organization's event.
  const resolved = await getOrgForUser(session.user.id);
  const org = resolved?.org;
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
  const resolved = await getOrgForUser(session.user.id);
  const org = resolved?.org;
  if (!org || !org._id)
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Editing and publishing is owner-only; refuse before we do any work.
  if (!can(resolved?.role, "manageEvents"))
    return NextResponse.json(
      { error: "Only the organization owner can edit or publish events" },
      { status: 403 },
    );
  const event = await getEventById(id);
  if (!event || !org?._id || event.organizationId !== org._id.toString())
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  // A suspended organization keeps its data but must not go live.
  if (parsed.data.status === "PUBLISHED" && org.status === "SUSPENDED")
    return NextResponse.json(
      { error: "This organization is suspended and cannot publish events" },
      { status: 403 },
    );

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

  const { slug, ...rest } = parsed.data;
  const patch: Record<string, unknown> = { ...rest };
  if (rest.startsAt) patch.startsAt = new Date(rest.startsAt);
  if (rest.endsAt) patch.endsAt = new Date(rest.endsAt);
  if (Object.keys(patch).length > 0) {
    const ok = await updateEvent(id, org._id.toString(), patch as never);
    if (!ok) return NextResponse.json({ error: "Update failed" }, { status: 400 });
  }

  if (typeof slug === "string") {
    const result = await updateEventSlug(id, org._id.toString(), slug);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({ ok: true, slug: result.slug });
  }

  return NextResponse.json({ ok: true });
}
