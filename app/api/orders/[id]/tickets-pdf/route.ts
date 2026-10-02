import { auth } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getDb, toObjectId } from "@/lib/db";
import { getOrderTicketPdf } from "@/lib/ticket-documents";
import type { Order } from "@/lib/types";

/**
 * The ticket PDF (tickets + fee invoice) for one order, for the buyer who
 * placed it. Scoped to the signed-in session's email, never to anything in the
 * URL; any other caller gets a 404 so order ids reveal nothing.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) return new Response("Sign in with the email you booked with.", { status: 401 });
  const { id } = await params;
  const _id = toObjectId(id);
  if (!_id) return new Response("Not found", { status: 404 });

  const db = await getDb();
  const order = await db
    .collection<Order>("orders")
    .findOne({ _id, buyerEmail: email, status: { $in: ["PAID", "PARTIALLY_REFUNDED"] } }, { projection: { _id: 1, organizationId: 1 } });
  if (!order) return new Response("Not found", { status: 404 });

  const pdf = await getOrderTicketPdf(id);
  if (!pdf) return new Response("Your tickets are still being prepared. Try again in a minute.", { status: 409 });
  await audit({
    actorId: session!.user!.id ?? null,
    actorRole: "SYSTEM",
    action: "tickets.pdf.downloaded",
    targetType: "order",
    targetId: id,
    organizationId: order.organizationId,
    meta: {},
  });
  return new Response(new Uint8Array(pdf.body), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${pdf.fileName.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
