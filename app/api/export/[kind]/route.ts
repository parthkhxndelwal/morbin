import { NextResponse } from "next/server";
import { orgActor } from "@/lib/action-guards";
import { exportAttendeesCsv, exportOrdersCsv, type ExportFilters } from "@/lib/exports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/export/orders?eventId=&status=&eventTitle=&q=
 * GET /api/export/attendees?eventId=&status=&q=
 *
 * Owner only (the `export` capability). Scoped to the caller's organisation;
 * a supplied eventId from another organisation simply matches nothing.
 */
export async function GET(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (kind !== "orders" && kind !== "attendees") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const guard = await orgActor("export", { allowSuspended: true });
  if ("error" in guard) return NextResponse.json({ error: guard.error }, { status: 403 });

  const url = new URL(request.url);
  const filters: ExportFilters = {
    eventId: url.searchParams.get("eventId"),
    status: url.searchParams.get("status"),
    eventTitle: url.searchParams.get("eventTitle"),
    q: url.searchParams.get("q"),
  };
  const actor = { userId: guard.actor.userId, role: "OWNER" as const };
  const { csv } =
    kind === "orders"
      ? await exportOrdersCsv(guard.actor.orgId, filters, actor)
      : await exportAttendeesCsv(guard.actor.orgId, filters, actor);

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="morbin-${kind}-${stamp}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
