import { NextResponse } from "next/server";
import { eventApiAccess } from "@/lib/event-access";
import { can } from "@/lib/permissions";
import { signTestRun } from "@/lib/test-run";

/**
 * POST — start "Run through checkout as a buyer": a link to the public event
 * page that opens the real drawer in test mode with the draft rules. Owner or
 * support only; the link expires after 15 minutes.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await eventApiAccess(id);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  if (!can(r.access.role, "manageEvents")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { event } = r.access;
  if (event.status === "CANCELLED") return NextResponse.json({ error: "This event is cancelled." }, { status: 409 });
  if (event.endsAt < new Date()) return NextResponse.json({ error: "This event has ended." }, { status: 409 });
  const token = signTestRun(event._id.toString(), r.access.userId);
  return NextResponse.json({ url: `/event/${event.slug}?test=${encodeURIComponent(token)}` });
}
