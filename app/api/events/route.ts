import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { createEventWithDefaults, getOrgEvents } from "@/lib/events";
import { getOrgForUser } from "@/lib/organizations";
import { can } from "@/lib/permissions";

const schema = z.object({
  title: z.string().min(3).max(120),
  description: z.string().min(10).max(5000),
  venue: z.string().min(2).max(200),
  timezone: z.string().min(1).max(60).default("Asia/Kolkata"),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  // Optional: an organizer who already knows the URL they want.
  slug: z.string().max(80).optional(),
});

function serialize(e: Record<string, unknown>) {
  return {
    id: String(e._id),
    title: e.title,
    slug: e.slug,
    status: e.status,
    venue: e.venue,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
  };
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Scoped through membership, so a MEMBER sees their org's events too.
  const resolved = await getOrgForUser(session.user.id);
  const org = resolved?.org;
  if (!org || !org._id) return NextResponse.json({ events: [] });
  const events = await getOrgEvents(org._id.toString());
  return NextResponse.json({ events: events.map((e) => serialize(e as never)) });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid event" }, { status: 400 });
  const resolved = await getOrgForUser(session.user.id);
  const org = resolved?.org;
  if (!org || !org._id)
    return NextResponse.json({ error: "Create an organization first" }, { status: 404 });
  // Creating an event is an owner-only action; refuse before we do any work.
  if (!can(resolved?.role, "manageEvents"))
    return NextResponse.json(
      { error: "Only the organization owner can create events" },
      { status: 403 },
    );
  const startsAt = new Date(parsed.data.startsAt);
  const endsAt = new Date(parsed.data.endsAt);
  if (endsAt <= startsAt)
    return NextResponse.json({ error: "Event must end after it starts" }, { status: 400 });
  const event = await createEventWithDefaults(org._id.toString(), {
    title: parsed.data.title,
    description: parsed.data.description,
    venue: parsed.data.venue,
    timezone: parsed.data.timezone,
    startsAt,
    endsAt,
    slug: parsed.data.slug,
  });

  return NextResponse.json(
    { event: serialize(event as unknown as Record<string, unknown>) },
    { status: 201 },
  );
}
