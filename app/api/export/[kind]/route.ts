import { NextResponse } from "next/server";
import { orgActor } from "@/lib/action-guards";
import { audit } from "@/lib/audit";
import { DatasetError, datasetExport } from "@/lib/datasets";
import { csvCell } from "@/lib/documents";
import { exportAttendeesCsv, exportOrdersCsv, type ExportFilters } from "@/lib/exports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/export/orders?eventId=&status=&eventTitle=&q=
 * GET /api/export/attendees?eventId=&status=&q=
 * GET /api/export/dataset?id=
 *
 * Owner only (the `export` capability). Scoped to the caller's organisation;
 * a supplied eventId from another organisation simply matches nothing.
 */
export async function GET(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (kind !== "orders" && kind !== "attendees" && kind !== "dataset") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const guard = await orgActor("export", { allowSuspended: true });
  if ("error" in guard) return NextResponse.json({ error: guard.error }, { status: 403 });
  if (kind === "dataset") return exportDataset(request, guard.actor.orgId, guard.actor.userId);

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

/**
 * A whole dataset as CSV, streamed (up to 2,00,000 rows) and audited with the
 * row count only. Cells go through `csvCell`, which neutralises spreadsheet
 * formula injection.
 */
async function exportDataset(request: Request, orgId: string, userId: string): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  let exp: Awaited<ReturnType<typeof datasetExport>>;
  try {
    exp = await datasetExport(orgId, id);
  } catch (error) {
    if (error instanceof DatasetError) return NextResponse.json({ error: "Not found" }, { status: 404 });
    throw error;
  }
  const line = (cells: unknown[]) => `${cells.map(csvCell).join(",")}\r\n`;
  const encoder = new TextEncoder();
  let rows = 0;
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(`\uFEFF${line(exp.header)}`));
        let chunk = "";
        for await (const cells of exp.rows) {
          chunk += line(cells);
          rows++;
          if (chunk.length > 64_000) {
            controller.enqueue(encoder.encode(chunk));
            chunk = "";
          }
        }
        if (chunk) controller.enqueue(encoder.encode(chunk));
        controller.close();
        await audit({
          actorId: userId,
          actorRole: "OWNER",
          action: "dataset.exported",
          targetType: "dataset",
          targetId: exp.dataset.id,
          organizationId: orgId,
          meta: { rows },
        });
      } catch (error) {
        console.error("[export] dataset stream failed", id, error);
        controller.error(error);
      }
    },
  });
  const name = exp.dataset.name.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "dataset";
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="morbin-${name}-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
