import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { auth } from "@/lib/auth";
import { getDb, toObjectId } from "@/lib/db";
import { getDocument, readDocumentBody } from "@/lib/documents";
import type { Membership } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Download a private document. Allowed for platform admins, and for the OWNER
 * of the organisation the document belongs to — staff members can't see money
 * documents. Every download is audit-logged.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const doc = await getDocument(id);
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const db = await getDb();
  const user = await db
    .collection<{ role?: string }>("users")
    .findOne({ _id: toObjectId(session.user.id) as never }, { projection: { role: 1 } });
  const isAdmin = user?.role === "ADMIN";
  let allowed = isAdmin;
  if (!allowed && doc.organizationId) {
    const membership = await db
      .collection<Membership>("memberships")
      .findOne({ organizationId: doc.organizationId, userId: session.user.id, role: "OWNER" });
    allowed = !!membership;
  }
  // Same response as a missing document, so ids can't be probed.
  if (!allowed) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: Buffer;
  try {
    body = await readDocumentBody(doc);
  } catch (error) {
    console.error("[documents] read failed", id, error);
    return NextResponse.json({ error: "This document is unavailable" }, { status: 500 });
  }
  await audit({
    actorId: session.user.id,
    actorRole: isAdmin ? "ADMIN" : "OWNER",
    action: "document.downloaded",
    targetType: "document",
    targetId: id,
    organizationId: doc.organizationId,
    meta: { kind: doc.kind },
  });
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": doc.contentType,
      "Content-Length": String(body.length),
      "Content-Disposition": `attachment; filename="${doc.fileName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
