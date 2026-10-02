import { ObjectId } from "mongodb";
import { audit, notify } from "@/lib/audit";
import { getDb, safeObjectIds, toObjectId } from "@/lib/db";
import { storeDocument, toCsv } from "@/lib/documents";
import { formatINR } from "@/lib/format";
import { issueOrgFeeInvoice } from "@/lib/invoices";
import { appendLedger, unsettledTotals } from "@/lib/ledger";
import { lockOrgBalance, TxAbort, withTransaction } from "@/lib/tx";
import type { LedgerEntry, Order, Payout, PayoutMessage, PayoutTotals } from "@/lib/types";

/**
 * Payouts — admin-driven, no schedule.
 *
 *   issue      DRAFT       unsettled ledger entries up to a cut-off are locked to it
 *   mark paid  PAID        bank reference + date + statement PDF (required)
 *   owner      ACKNOWLEDGED, or DISPUTED with a query
 *   admin      RESOLVED (reply, corrected statement, or an adjustment for next time)
 *   cancel     CANCELLED   (DRAFT only) entries released back to unsettled
 *
 * Locking entries happens in one transaction with a re-count, so an entry can
 * never be in two payouts, and an entry written mid-issue is simply left for
 * the next one.
 */

function oid(id: string): ObjectId {
  const o = toObjectId(id);
  if (!o) throw new TxAbort("Payout not found", 404);
  return o;
}

export async function previewPayout(
  organizationId: string,
  cutoff: Date,
): Promise<{ totals: PayoutTotals; count: number }> {
  const db = await getDb();
  return unsettledTotals(db, organizationId, { cutoff });
}

export async function issuePayout(input: {
  organizationId: string;
  cutoff: Date;
  note: string | null;
  adminId: string;
}): Promise<Payout> {
  if (input.cutoff > new Date()) throw new TxAbort("The cut-off can't be in the future.");
  const payout = await withTransaction(async (session, db) => {
    await lockOrgBalance(db, session, input.organizationId);
    const open = await db
      .collection<Payout>("payouts")
      .countDocuments({ organizationId: input.organizationId, status: "DRAFT" }, { session });
    if (open > 0) throw new TxAbort("This organisation already has a draft payout. Pay or cancel it first.", 409);

    const { totals, count } = await unsettledTotals(db, input.organizationId, {
      cutoff: input.cutoff,
      session,
    });
    if (count === 0) throw new TxAbort("There's nothing to pay out up to that date.");
    if (totals.netPaise <= 0) {
      throw new TxAbort(`The net amount up to that date is ${formatINR(totals.netPaise)} — nothing to pay out.`);
    }
    const now = new Date();
    const doc: Payout = {
      _id: new ObjectId(),
      organizationId: input.organizationId,
      status: "DRAFT",
      cutoffAt: input.cutoff,
      totals,
      entryCount: count,
      bankReference: null,
      transferredAt: null,
      statementDocId: null,
      breakdownDocId: null,
      note: input.note,
      createdBy: input.adminId,
      paidBy: null,
      acknowledgedBy: null,
      acknowledgedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await db.collection<Payout>("payouts").insertOne(doc, { session });
    const locked = await db.collection<LedgerEntry>("ledgerEntries").updateMany(
      { organizationId: input.organizationId, payoutId: null, createdAt: { $lte: input.cutoff } },
      { $set: { payoutId: doc._id!.toString() } },
      { session },
    );
    if (locked.modifiedCount !== count) throw new TxAbort("The balance changed while issuing — try again.", 409);
    return doc;
  });
  await audit({
    actorId: input.adminId,
    actorRole: "ADMIN",
    action: "payout.issued",
    targetType: "payout",
    targetId: payout._id!.toString(),
    organizationId: input.organizationId,
    meta: { netPaise: payout.totals.netPaise, entries: payout.entryCount, cutoff: input.cutoff.toISOString() },
  });
  return payout;
}

export async function cancelPayout(id: string, adminId: string): Promise<void> {
  const payout = await withTransaction(async (session, db) => {
    const p = await db
      .collection<Payout>("payouts")
      .findOneAndUpdate(
        { _id: oid(id), status: "DRAFT" },
        { $set: { status: "CANCELLED", updatedAt: new Date() } },
        { session },
      );
    if (!p) throw new TxAbort("Only a draft payout can be cancelled.", 409);
    await db
      .collection<LedgerEntry>("ledgerEntries")
      .updateMany({ payoutId: id }, { $set: { payoutId: null } }, { session });
    return p;
  });
  await audit({
    actorId: adminId,
    actorRole: "ADMIN",
    action: "payout.cancelled",
    targetType: "payout",
    targetId: id,
    organizationId: payout.organizationId,
    meta: {},
  });
}

/** A CSV of every ledger entry in the payout, with order references. */
async function buildBreakdownCsv(payout: Payout): Promise<Buffer> {
  const db = await getDb();
  const entries = await db
    .collection<LedgerEntry>("ledgerEntries")
    .find({ payoutId: payout._id!.toString() })
    .sort({ createdAt: 1 })
    .toArray();
  const orderIds = [...new Set(entries.map((e) => e.orderId).filter((x): x is string => !!x))];
  const orders = orderIds.length
    ? await db
        .collection<Order>("orders")
        .find({ _id: { $in: safeObjectIds(orderIds) } }, { projection: { buyerName: 1, eventId: 1, paidAt: 1 } })
        .toArray()
    : [];
  const eventIds = [...new Set(entries.map((e) => e.eventId).filter((x): x is string => !!x))];
  const events = eventIds.length
    ? await db
        .collection("events")
        .find({ _id: { $in: safeObjectIds(eventIds) } }, { projection: { title: 1 } })
        .toArray()
    : [];
  const orderBy = new Map(orders.map((o) => [o._id!.toString(), o]));
  const eventBy = new Map(events.map((e) => [e._id.toString(), e.title as string]));
  const rows = entries.map((e) => [
    e.createdAt.toISOString(),
    e.type,
    e.eventId ? (eventBy.get(e.eventId) ?? e.eventId) : "",
    e.orderId ?? "",
    e.orderId ? (orderBy.get(e.orderId)?.buyerName ?? "") : "",
    e.memo,
    (e.amountPaise / 100).toFixed(2),
  ]);
  rows.push(["", "", "", "", "", "Net payout", (payout.totals.netPaise / 100).toFixed(2)]);
  return Buffer.from(
    toCsv(["Date (UTC)", "Type", "Event", "Order", "Buyer", "Description", "Amount (INR)"], rows),
    "utf8",
  );
}

/** Record the bank transfer and attach the statement; DRAFT → PAID. */
export async function markPayoutPaid(input: {
  id: string;
  adminId: string;
  bankReference: string;
  transferredAt: Date;
  statement: { fileName: string; body: Buffer };
}): Promise<Payout> {
  const db = await getDb();
  const payout = await db.collection<Payout>("payouts").findOne({ _id: oid(input.id) });
  if (!payout || payout.status !== "DRAFT") throw new TxAbort("Only a draft payout can be marked paid.", 409);
  if (!input.bankReference.trim()) throw new TxAbort("Enter the bank transfer reference (UTR).");
  if (input.transferredAt > new Date()) throw new TxAbort("The transfer date can't be in the future.");

  const statement = await storeDocument({
    organizationId: payout.organizationId,
    kind: "PAYOUT_STATEMENT",
    fileName: input.statement.fileName,
    contentType: "application/pdf",
    body: input.statement.body,
    uploadedBy: input.adminId,
  });
  const breakdown = await storeDocument({
    organizationId: payout.organizationId,
    kind: "PAYOUT_BREAKDOWN",
    fileName: `payout-${input.id.slice(-8)}-breakdown.csv`,
    contentType: "text/csv",
    body: await buildBreakdownCsv(payout),
    uploadedBy: input.adminId,
  });

  const updated = await db.collection<Payout>("payouts").findOneAndUpdate(
    { _id: payout._id, status: "DRAFT" },
    {
      $set: {
        status: "PAID",
        bankReference: input.bankReference.trim(),
        transferredAt: input.transferredAt,
        statementDocId: statement._id!.toString(),
        breakdownDocId: breakdown._id!.toString(),
        paidBy: input.adminId,
        updatedAt: new Date(),
      },
    },
    { returnDocument: "after" },
  );
  if (!updated) throw new TxAbort("This payout changed — reload and try again.", 409);
  await audit({
    actorId: input.adminId,
    actorRole: "ADMIN",
    action: "payout.paid",
    targetType: "payout",
    targetId: input.id,
    organizationId: payout.organizationId,
    meta: { netPaise: payout.totals.netPaise, bankReference: input.bankReference.trim() },
  });
  // The payout is paid whatever happens here; a failed invoice is retried from
  // the admin payout page ("Issue fee invoice").
  try {
    await issueOrgFeeInvoice(input.id);
  } catch (error) {
    console.error("[payouts] fee invoice failed", input.id, error);
  }
  await notify({
    organizationId: payout.organizationId,
    audience: "ORG_OWNER",
    kind: "PAYOUT_PAID",
    title: `Payout of ${formatINR(payout.totals.netPaise)} sent`,
    body: "Review the statement and acknowledge it, or raise a query.",
    link: `/dashboard/payouts/${input.id}`,
  });
  return (await db.collection<Payout>("payouts").findOne({ _id: payout._id })) ?? updated;
}

export async function acknowledgePayout(organizationId: string, id: string, userId: string): Promise<void> {
  const db = await getDb();
  const r = await db.collection<Payout>("payouts").updateOne(
    { _id: oid(id), organizationId, status: { $in: ["PAID", "RESOLVED"] } },
    {
      $set: { status: "ACKNOWLEDGED", acknowledgedBy: userId, acknowledgedAt: new Date(), updatedAt: new Date() },
    },
  );
  if (r.modifiedCount === 0) throw new TxAbort("This payout can't be acknowledged now.", 409);
  await audit({
    actorId: userId,
    actorRole: "OWNER",
    action: "payout.acknowledged",
    targetType: "payout",
    targetId: id,
    organizationId,
    meta: {},
  });
}

export async function raisePayoutQuery(
  organizationId: string,
  id: string,
  userId: string,
  message: string,
): Promise<void> {
  const text = message.trim();
  if (text.length < 5) throw new TxAbort("Describe what doesn't look right.");
  await withTransaction(async (session, db) => {
    const r = await db
      .collection<Payout>("payouts")
      .updateOne(
        { _id: oid(id), organizationId, status: { $in: ["PAID", "RESOLVED", "DISPUTED"] } },
        { $set: { status: "DISPUTED", updatedAt: new Date() } },
        { session },
      );
    if (r.matchedCount === 0) throw new TxAbort("You can't raise a query on this payout now.", 409);
    await db.collection<PayoutMessage>("payoutMessages").insertOne(
      { payoutId: id, organizationId, authorId: userId, authorRole: "OWNER", message: text, createdAt: new Date() },
      { session },
    );
  });
  await notify({
    organizationId: null,
    audience: "ADMIN",
    kind: "PAYOUT_QUERY",
    title: "Payout query raised",
    body: text.slice(0, 140),
    link: `/dashboard/admin/payouts/${id}`,
  });
}

/** Admin replies; optionally resolves and/or books an adjustment for the next payout. */
export async function replyToPayoutQuery(input: {
  id: string;
  adminId: string;
  message: string;
  resolve: boolean;
  adjustmentPaise: number;
}): Promise<void> {
  const text = input.message.trim();
  if (!text) throw new TxAbort("Write a reply.");
  if (!Number.isInteger(input.adjustmentPaise)) throw new TxAbort("Invalid adjustment amount.");
  const payout = await withTransaction(async (session, db) => {
    const p = await db.collection<Payout>("payouts").findOne({ _id: oid(input.id) }, { session });
    if (!p || p.status === "DRAFT" || p.status === "CANCELLED") throw new TxAbort("Payout not found", 404);
    await db.collection<PayoutMessage>("payoutMessages").insertOne(
      {
        payoutId: input.id,
        organizationId: p.organizationId,
        authorId: input.adminId,
        authorRole: "ADMIN",
        message: text,
        createdAt: new Date(),
      },
      { session },
    );
    if (input.adjustmentPaise !== 0) {
      await appendLedger(db, session, [
        {
          organizationId: p.organizationId,
          eventId: null,
          orderId: null,
          refundCaseId: null,
          type: "ADJUSTMENT",
          amountPaise: input.adjustmentPaise,
          memo: `Adjustment for payout ${input.id.slice(-8).toUpperCase()}: ${text.slice(0, 80)}`,
          key: `adjustment:${input.id}:${new ObjectId().toString()}`,
          createdBy: input.adminId,
        },
      ]);
    }
    if (input.resolve && p.status === "DISPUTED") {
      await db
        .collection<Payout>("payouts")
        .updateOne({ _id: p._id }, { $set: { status: "RESOLVED", updatedAt: new Date() } }, { session });
    }
    return p;
  });
  await audit({
    actorId: input.adminId,
    actorRole: "ADMIN",
    action: input.resolve ? "payout.query_resolved" : "payout.query_replied",
    targetType: "payout",
    targetId: input.id,
    organizationId: payout.organizationId,
    meta: { adjustmentPaise: input.adjustmentPaise },
  });
  await notify({
    organizationId: payout.organizationId,
    audience: "ORG_OWNER",
    kind: "PAYOUT_REPLY",
    title: input.resolve ? "Your payout query was resolved" : "Morbin replied to your payout query",
    body: text.slice(0, 140),
    link: `/dashboard/payouts/${input.id}`,
  });
}

/** Replace the statement on a disputed payout (the old document is kept). */
export async function replacePayoutStatement(input: {
  id: string;
  adminId: string;
  statement: { fileName: string; body: Buffer };
}): Promise<void> {
  const db = await getDb();
  const payout = await db.collection<Payout>("payouts").findOne({ _id: oid(input.id) });
  if (!payout || !["PAID", "DISPUTED", "RESOLVED"].includes(payout.status)) {
    throw new TxAbort("The statement can only be replaced after the payout is paid.", 409);
  }
  const doc = await storeDocument({
    organizationId: payout.organizationId,
    kind: "PAYOUT_STATEMENT",
    fileName: input.statement.fileName,
    contentType: "application/pdf",
    body: input.statement.body,
    uploadedBy: input.adminId,
  });
  await db
    .collection<Payout>("payouts")
    .updateOne({ _id: payout._id }, { $set: { statementDocId: doc._id!.toString(), updatedAt: new Date() } });
  await audit({
    actorId: input.adminId,
    actorRole: "ADMIN",
    action: "payout.statement_replaced",
    targetType: "payout",
    targetId: input.id,
    organizationId: payout.organizationId,
    meta: { previous: payout.statementDocId },
  });
}
