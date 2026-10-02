import "server-only";

import { audit } from "@/lib/audit";
import { getDb, toObjectId } from "@/lib/db";
import { getPlatformSettings, gstReady } from "@/lib/platform-settings";
import { withTransaction } from "@/lib/tx";
import { financialYear, invoiceNumber, splitTax } from "@/lib/invoice-rules";
import type { Invoice, Order } from "@/lib/types";

/**
 * GST tax invoices for the convenience fee.
 *
 * When the buyer pays the fee, Morbin supplies them a service and invoices it.
 * Numbering is gapless per financial year: the counter is incremented in the
 * same transaction that inserts the invoice, so an aborted issue never burns a
 * number. The supplier's GST details are copied into the invoice, so changing
 * Admin → Settings later never alters an issued invoice.
 */

/** Whether this order's buyer paid a fee that must be invoiced. */
export function needsCustomerInvoice(order: Pick<Order, "pricing">): boolean {
  return order.pricing?.bearer === "CUSTOMER" && (order.pricing?.feePaise ?? 0) > 0;
}

/**
 * Issue (or return the existing) fee invoice for an order. Returns null when
 * none is due, or when Morbin's GST details aren't complete yet — that is
 * audit-logged so it can be issued once they are.
 */
export async function issueCustomerInvoice(orderId: string, eventTitle: string): Promise<Invoice | null> {
  const db = await getDb();
  const _id = toObjectId(orderId);
  if (!_id) return null;
  const order = await db.collection<Order>("orders").findOne({ _id });
  if (!order || !needsCustomerInvoice(order)) return null;
  const existing = await db.collection<Invoice>("invoices").findOne({ orderId, kind: "CUSTOMER_FEE" });
  if (existing) return existing;

  const settings = await getPlatformSettings();
  if (!gstReady(settings.gst)) {
    await audit({
      actorId: null,
      actorRole: "SYSTEM",
      action: "invoice.skipped",
      targetType: "order",
      targetId: orderId,
      organizationId: order.organizationId,
      meta: { reason: "gst_settings_incomplete" },
    });
    return null;
  }

  const pricing = order.pricing!;
  const issuedAt = order.paidAt ?? new Date();
  const fy = financialYear(issuedAt);
  const prefix = settings.gst.invoicePrefix || "MRB";
  const tax = splitTax(pricing.feeGstPaise, settings.gst.splitRule);

  return withTransaction(async (session, tx) => {
    const again = await tx.collection<Invoice>("invoices").findOne({ orderId, kind: "CUSTOMER_FEE" }, { session });
    if (again) return again;
    const counter = await tx
      .collection<{ _id: string; seq: number }>("counters")
      .findOneAndUpdate(
        { _id: `invoice:${prefix}:${fy}` },
        { $inc: { seq: 1 } },
        { upsert: true, returnDocument: "after", session },
      );
    const invoice: Invoice = {
      number: invoiceNumber(prefix, fy, counter!.seq),
      financialYear: fy,
      kind: "CUSTOMER_FEE",
      orderId,
      organizationId: order.organizationId,
      recipient: { name: order.buyerName, email: order.buyerEmail },
      placeOfSupply: `${settings.gst.state} (${settings.gst.stateCode})`,
      sac: settings.gst.sac,
      description: `Convenience fee — order ${orderId.slice(-8).toUpperCase()}, ${eventTitle}`,
      taxablePaise: pricing.feeBasePaise,
      ...tax,
      totalPaise: pricing.feePaise,
      rateBps: pricing.gstBps,
      supplier: settings.gst,
      issuedAt,
    };
    const { insertedId } = await tx.collection<Invoice>("invoices").insertOne(invoice, { session });
    await tx.collection<Order>("orders").updateOne({ _id }, { $set: { invoiceId: insertedId.toString() } }, { session });
    return { ...invoice, _id: insertedId };
  });
}
