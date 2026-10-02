import "server-only";

import type { ClientSession, Db } from "mongodb";
import { audit } from "@/lib/audit";
import { getDb, safeObjectIds, toObjectId } from "@/lib/db";
import { deleteDocument, storeDocument } from "@/lib/documents";
import { getPlatformSettings, gstReady } from "@/lib/platform-settings";
import { gstPortion } from "@/lib/pricing";
import { buildInvoicePdf } from "@/lib/ticket-pdf";
import { withTransaction } from "@/lib/tx";
import { financialYear, invoiceNumber, orgPlaceOfSupply, splitTax, splitTaxFor } from "@/lib/invoice-rules";
import type { Invoice, LedgerEntry, Order, Organization, Payout } from "@/lib/types";

/**
 * GST tax invoices for the convenience fee.
 *
 * When the buyer pays the fee, Morbin supplies them a service and invoices it.
 * Numbering is gapless per financial year: the counter is incremented in the
 * same transaction that inserts the invoice, so an aborted issue never burns a
 * number. The supplier's GST details are copied into the invoice, so changing
 * Admin → Settings later never alters an issued invoice.
 *
 * Two kinds share one numbering series:
 *   CUSTOMER_FEE  the buyer paid the fee — one invoice per order, to the buyer
 *   ORG_FEE       the organisation absorbed the fee — one invoice per payout,
 *                 to the organisation, issued when the payout is marked paid
 */

/** Take the next number in the series, inside the caller's transaction. */
async function nextInvoiceNumber(tx: Db, session: ClientSession, prefix: string, fy: string): Promise<string> {
  const counter = await tx
    .collection<{ _id: string; seq: number }>("counters")
    .findOneAndUpdate(
      { _id: `invoice:${prefix}:${fy}` },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: "after", session },
    );
  return invoiceNumber(prefix, fy, counter!.seq);
}

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
    const invoice: Invoice = {
      number: await nextInvoiceNumber(tx, session, prefix, fy),
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

export interface OrgFeeAmounts {
  taxablePaise: number;
  gstPaise: number;
  totalPaise: number;
  rateBps: number;
  orderCount: number;
}

/**
 * The fee portion of a payout, from the frozen pricing of the orders behind
 * its PLATFORM_FEE ledger entries. Refunds and adjustments don't change it:
 * the fee is non-refundable, so a refund never writes a fee reversal and a
 * payout's fee entries are exactly the fees the organisation absorbed.
 */
export async function orgFeeAmounts(payoutId: string, fallbackGstBps: number): Promise<OrgFeeAmounts> {
  const db = await getDb();
  const entries = await db
    .collection<LedgerEntry>("ledgerEntries")
    .find({ payoutId, type: "PLATFORM_FEE" }, { projection: { orderId: 1, amountPaise: 1 } })
    .toArray();
  const orderIds = entries.map((e) => e.orderId).filter((x): x is string => !!x);
  const orders = orderIds.length
    ? await db
        .collection<Order>("orders")
        .find({ _id: { $in: safeObjectIds(orderIds) } }, { projection: { pricing: 1 } })
        .toArray()
    : [];
  const pricingBy = new Map(orders.map((o) => [o._id!.toString(), o.pricing]));
  const rates = new Set<number>();
  let totalPaise = 0;
  let gstPaise = 0;
  for (const entry of entries) {
    const fee = -entry.amountPaise;
    const pricing = entry.orderId ? pricingBy.get(entry.orderId) : undefined;
    totalPaise += fee;
    if (pricing && pricing.feePaise === fee) {
      gstPaise += pricing.feeGstPaise;
      rates.add(pricing.gstBps);
    } else {
      // Pre-pricing orders froze no split: carve GST out at the current rate.
      gstPaise += gstPortion(fee, fallbackGstBps);
      rates.add(fallbackGstBps);
    }
  }
  return {
    taxablePaise: totalPaise - gstPaise,
    gstPaise,
    totalPaise,
    // A rate change mid-payout would mix rates; the printed rate is then the
    // current one, while the amounts stay those actually charged.
    rateBps: rates.size === 1 ? [...rates][0] : fallbackGstBps,
    orderCount: entries.length,
  };
}

/**
 * Issue (or return the existing) ORG_FEE invoice for a paid payout, and make
 * sure its PDF is stored and linked from the payout. Idempotent: safe to call
 * again after a crash between the two steps. Returns null when the payout has
 * no absorbed fees, or when Morbin's GST details aren't complete (audited).
 */
export async function issueOrgFeeInvoice(payoutId: string): Promise<Invoice | null> {
  const db = await getDb();
  const _id = toObjectId(payoutId);
  if (!_id) return null;
  const payout = await db.collection<Payout>("payouts").findOne({ _id });
  if (!payout || payout.status === "DRAFT" || payout.status === "CANCELLED") return null;
  if (payout.totals.feesPaise === 0) return null;

  let invoice = await db.collection<Invoice>("invoices").findOne({ payoutId, kind: "ORG_FEE" });
  if (!invoice) {
    const settings = await getPlatformSettings();
    if (!gstReady(settings.gst)) {
      await audit({
        actorId: null,
        actorRole: "SYSTEM",
        action: "invoice.skipped",
        targetType: "payout",
        targetId: payoutId,
        organizationId: payout.organizationId,
        meta: { reason: "gst_settings_incomplete", kind: "ORG_FEE" },
      });
      return null;
    }
    const org = await db
      .collection<Organization>("organizations")
      .findOne({ _id: toObjectId(payout.organizationId)! });
    if (!org) return null;
    const amounts = await orgFeeAmounts(payoutId, settings.gst.rateBps);
    if (amounts.totalPaise <= 0) return null;

    const pos = orgPlaceOfSupply({
      supplier: settings.gst,
      recipient: { gstin: org.gstin, state: org.state, stateCode: org.stateCode },
    });
    const issuedAt = payout.transferredAt ?? new Date();
    const fy = financialYear(issuedAt);
    const prefix = settings.gst.invoicePrefix || "MRB";
    const ref = payoutId.slice(-8).toUpperCase();

    invoice = await withTransaction(async (session, tx) => {
      const again = await tx.collection<Invoice>("invoices").findOne({ payoutId, kind: "ORG_FEE" }, { session });
      if (again) return again;
      const doc: Invoice = {
        number: await nextInvoiceNumber(tx, session, prefix, fy),
        financialYear: fy,
        kind: "ORG_FEE",
        payoutId,
        organizationId: payout.organizationId,
        recipient: {
          name: org.name,
          email: org.contactEmail ?? "",
          gstin: org.gstin ?? null,
          address: org.address ?? null,
          state: pos.state,
          stateCode: pos.stateCode,
        },
        placeOfSupply: `${pos.state} (${pos.stateCode})`,
        sac: settings.gst.sac,
        description:
          `Platform fee — payout ${ref}, ${amounts.orderCount} ` +
          `order${amounts.orderCount === 1 ? "" : "s"} up to ${payout.cutoffAt.toISOString().slice(0, 10)}`,
        taxablePaise: amounts.taxablePaise,
        ...splitTaxFor(amounts.gstPaise, pos.interState),
        totalPaise: amounts.totalPaise,
        rateBps: amounts.rateBps,
        supplier: settings.gst,
        issuedAt,
      };
      const { insertedId } = await tx.collection<Invoice>("invoices").insertOne(doc, { session });
      return { ...doc, _id: insertedId };
    });
  }

  if (!payout.invoiceDocId) {
    const stored = await storeDocument({
      organizationId: payout.organizationId,
      kind: "ORG_FEE_INVOICE",
      fileName: `invoice-${invoice.number.replace(/\//g, "-")}.pdf`,
      contentType: "application/pdf",
      body: Buffer.from(await buildInvoicePdf(invoice)),
      uploadedBy: null,
    });
    const linked = await db
      .collection<Payout>("payouts")
      .updateOne({ _id, invoiceDocId: { $in: [null] } }, { $set: { invoiceDocId: stored._id!.toString() } });
    // Lost a race with a concurrent call: keep theirs, drop ours.
    if (linked.modifiedCount === 0) await deleteDocument(stored._id!.toString());
  }
  return invoice;
}
