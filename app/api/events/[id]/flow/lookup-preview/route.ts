import { NextResponse } from "next/server";
import { z } from "zod";
import { eventApiAccess } from "@/lib/event-access";
import { lookupPreview } from "@/lib/lookups";
import { can } from "@/lib/permissions";
import { clientIp, rateLimit } from "@/lib/rate-limit";

/**
 * The builder's "Try it as a buyer" for a lookup question: does a sample value
 * match the dataset, and which address would it derive? Owner or support
 * (`manageEvents`) only, scoped to the event's organisation; writes nothing.
 */
const bodySchema = z.object({
  value: z.string().max(100),
  lookup: z.object({
    datasetId: z.string().min(1).max(60),
    matchColumn: z.string().min(1).max(60),
    emailTemplate: z.string().max(200).nullish(),
    oneTicketPerRow: z.boolean(),
  }),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await eventApiAccess(id);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  if (!can(r.access.role, "manageEvents")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await rateLimit("lookup-preview", `${r.access.userId}:${await clientIp()}`, 60, 60_000))) {
    return NextResponse.json({ error: "Slow down a little." }, { status: 429 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const result = await lookupPreview(r.access.org._id.toString(), r.access.event._id.toString(), parsed.data.lookup, parsed.data.value);
  return NextResponse.json(result);
}
