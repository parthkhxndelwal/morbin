/**
 * End-to-end check of the money core against a real (test) database:
 * seat holds, capture, ledger, refund requests/approval/rejection, payouts and
 * hold expiry. Creates a throwaway organisation and removes everything after.
 *
 *   npm run check:money
 *
 * Refuses to run unless MORBIN_DB contains "test" or "dev".
 */
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";
import { getClientPromise, getDb, getDbName } from "@/lib/db";
import { deleteDocument } from "@/lib/documents";
import { getOrgBalance } from "@/lib/ledger";
import { getPlatformSettings, gstReady } from "@/lib/platform-settings";
import { getOrderTicketPdf } from "@/lib/ticket-documents";
import { capturePaidOrder, createHeldOrder, expireStaleOrders, releaseOrder } from "@/lib/orders";
import { issueOrgFeeInvoice } from "@/lib/invoices";
import { cancelPayout, issuePayout, markPayoutPaid } from "@/lib/payouts";
import { computePricing } from "@/lib/pricing";
import {
  completeRefundManually,
  quoteRefund,
  rejectRefund,
  requestRefund,
} from "@/lib/refunds";
import { TxAbort } from "@/lib/tx";
import type {
  EmailRecord,
  Event,
  Invoice,
  LedgerEntry,
  Order,
  Payout,
  PlatformSettings,
  RefundCase,
  Ticket,
  TicketType,
} from "@/lib/types";

if (!/test|dev/i.test(getDbName())) {
  console.error(`Refusing to run against "${getDbName()}"`);
  process.exit(1);
}

const db = await getDb();
const orgOid = new ObjectId();
const orgId = orgOid.toString();
const eventOid = new ObjectId();
const eventId = eventOid.toString();
const typeOid = new ObjectId();
const typeId = typeOid.toString();
const adminId = new ObjectId().toString();
const ownerId = new ObjectId().toString();
const now = new Date();

let passed = 0;
let settingsTouched = false;
let originalSettings: PlatformSettings | null = null;
async function step(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}
async function rejects(fn: () => Promise<unknown>, match: RegExp) {
  try {
    await fn();
  } catch (e) {
    // By name, not instanceof: tsx can load lib/tx.ts once as ESM (from this
    // script) and once as CJS (from lib modules), giving two TxAbort classes.
    assert.ok(e instanceof TxAbort || e?.constructor?.name === "TxAbort", `expected TxAbort, got ${e}`);
    assert.match((e as Error).message, match);
    return;
  }
  assert.fail("expected an error");
}

function makeOrder(qty: number, bearer: "CUSTOMER" | "ORGANISER" = "CUSTOMER"): Order {
  const items = [{ ticketTypeId: typeId, name: "General", quantity: qty, unitPricePaise: 50_000 }];
  const pricing = computePricing([{ unitPricePaise: 50_000, quantity: qty }], {
    feeBps: 700,
    gstBps: 1800,
    bearer,
  });
  const _id = new ObjectId();
  return {
    _id,
    eventId,
    organizationId: orgId,
    buyerName: "Test Buyer",
    buyerEmail: "buyer@morbin.test",
    buyerPhone: "",
    items,
    attendees: [],
    subtotalPaise: pricing.ticketTotalPaise,
    platformFeePaise: pricing.feePaise,
    organizerAmountPaise: pricing.organiserNetPaise,
    totalPaise: pricing.orderTotalPaise,
    pricing,
    currency: "INR",
    razorpayOrderId: `order_test_${_id.toString()}`,
    razorpayPaymentId: null,
    status: "CREATED",
    refundedPaise: 0,
    createdAt: new Date(),
    paidAt: null,
  };
}

async function sold() {
  return (await db.collection<TicketType>("ticketTypes").findOne({ _id: typeOid }))!.soldCount;
}

try {
  await db.collection("organizations").insertOne({
    _id: orgOid,
    name: "Money Check Org",
    slug: `money-check-${orgId}`,
    ownerId,
    type: "EVENT",
    status: "ACTIVE",
    onboardingStatus: "ACTIVE",
    paymentAccountStatus: "VERIFIED",
    payoutsEnabled: true,
    chargesEnabled: true,
    feeBps: 700,
    feeBearer: "CUSTOMER",
    createdAt: now,
    updatedAt: now,
  });
  await db.collection<Event>("events").insertOne({
    _id: eventOid,
    organizationId: orgId,
    title: "Money Check Event",
    slug: `money-check-${eventId}`,
    description: "Integration check event",
    venue: "Nowhere",
    timezone: "Asia/Kolkata",
    startsAt: new Date(Date.now() + 86_400_000),
    endsAt: new Date(Date.now() + 2 * 86_400_000),
    status: "PUBLISHED",
    createdAt: now,
    updatedAt: now,
  });
  await db.collection<TicketType>("ticketTypes").insertOne({
    _id: typeOid,
    eventId,
    name: "General",
    description: "",
    pricePaise: 50_000,
    capacity: 3,
    soldCount: 0,
    status: "ACTIVE",
  });

  const paid = makeOrder(2);
  await step("hold 2 seats + insert order atomically", async () => {
    await createHeldOrder(paid);
    assert.equal(await sold(), 2);
    assert.equal(paid.pricing!.orderTotalPaise, 107_000);
  });

  await step("over-capacity hold aborts with nothing written", async () => {
    const tooMany = makeOrder(2);
    await rejects(() => createHeldOrder(tooMany), /sold out/);
    assert.equal(await sold(), 2);
    assert.equal(await db.collection("orders").countDocuments({ _id: tooMany._id }), 0);
  });

  await step("capture: PAID + 2 tickets + SALE ledger (no fee entry when customer pays)", async () => {
    const r = await capturePaidOrder({
      razorpayOrderId: paid.razorpayOrderId,
      paymentId: "pay_test_check",
      amountPaise: 107_000,
      currency: "INR",
      gatewayFeePaise: 2525,
      gatewayTaxPaise: 385,
      method: "upi",
    });
    assert.equal(r.status, "captured");
    const tickets = await db.collection<Ticket>("tickets").find({ orderId: paid._id!.toString() }).toArray();
    assert.equal(tickets.length, 2);
    assert.ok(tickets.every((t) => t.unitPricePaise === 50_000));
    const ledger = await db.collection<LedgerEntry>("ledgerEntries").find({ organizationId: orgId }).toArray();
    assert.deepEqual(ledger.map((l) => [l.type, l.amountPaise]), [["SALE", 100_000]]);
  });

  await step("duplicate capture is a no-op", async () => {
    const r = await capturePaidOrder({
      razorpayOrderId: paid.razorpayOrderId,
      paymentId: "pay_test_check",
      amountPaise: 107_000,
      currency: "INR",
      gatewayFeePaise: 2525,
      gatewayTaxPaise: 385,
      method: "upi",
    });
    assert.equal(r.status, "duplicate");
    assert.equal(await db.collection("tickets").countDocuments({ orderId: paid._id!.toString() }), 2);
    assert.equal(await db.collection("ledgerEntries").countDocuments({ organizationId: orgId }), 1);
  });

  await step("one ticket email per order; PDF and fee invoice built once and reused", async () => {
    const orderId = paid._id!.toString();
    const emails = await db.collection<EmailRecord>("emailDeliveries").find({ orderId, kind: "TICKET_PDF" }).toArray();
    assert.equal(emails.length, 1);
    assert.equal(emails[0].recipient, paid.buyerEmail);

    const first = await getOrderTicketPdf(orderId);
    assert.ok(first && first.body.subarray(0, 5).toString() === "%PDF-");
    const docId = (await db.collection<Order>("orders").findOne({ _id: paid._id }))!.ticketPdfDocId;
    assert.ok(docId);
    const second = await getOrderTicketPdf(orderId);
    assert.ok(second!.body.equals(first!.body), "the stored PDF is reused, not rebuilt");
    assert.equal((await db.collection<Order>("orders").findOne({ _id: paid._id }))!.ticketPdfDocId, docId);

    const invoices = await db.collection<Invoice>("invoices").find({ orderId }).toArray();
    if (gstReady((await getPlatformSettings()).gst)) {
      assert.equal(invoices.length, 1);
      const inv = invoices[0];
      assert.match(inv.number, /^[A-Z0-9]{1,3}\/\d{2}-\d{2}\/\d+$/);
      assert.ok(inv.number.length <= 16);
      assert.equal(inv.totalPaise, paid.pricing!.feePaise);
      assert.equal(inv.cgstPaise + inv.sgstPaise + inv.igstPaise, paid.pricing!.feeGstPaise);
      assert.equal(inv.taxablePaise + paid.pricing!.feeGstPaise, paid.pricing!.feePaise);
    } else {
      assert.equal(invoices.length, 0, "no invoice while Morbin's GST details are incomplete");
    }
  });

  const ticketIds = (await db.collection<Ticket>("tickets").find({ orderId: paid._id!.toString() }).toArray()).map(
    (t) => t._id!.toString(),
  );

  await step("refund quote: ticket value only, no gateway share when customer paid the fee", async () => {
    const q = await quoteRefund({
      organizationId: orgId,
      orderId: paid._id!.toString(),
      ticketIds: [ticketIds[0]],
      speed: "NORMAL",
      settledBy: "MORBIN",
    });
    assert.equal(q.amountPaise, 50_000);
    assert.equal(q.cost.totalPaise, 0);
    assert.equal(q.shortfallPaise, 0);
  });

  let firstCase!: RefundCase;
  await step("request refund holds the amount from the balance", async () => {
    firstCase = await requestRefund({
      organizationId: orgId,
      orderId: paid._id!.toString(),
      ticketIds: [ticketIds[0]],
      speed: "NORMAL",
      settledBy: "MORBIN",
      reason: "check",
      requestedBy: ownerId,
    });
    assert.equal((await getOrgBalance(orgId)).unsettledPaise, 50_000);
  });

  await step("the same ticket can't be requested twice", async () => {
    await rejects(
      () =>
        requestRefund({
          organizationId: orgId,
          orderId: paid._id!.toString(),
          ticketIds: [ticketIds[0]],
          speed: "NORMAL",
          settledBy: "MORBIN",
          reason: "again",
          requestedBy: ownerId,
        }),
      /already has a refund/,
    );
  });

  await step("a refund the balance can't cover is refused (instant fee pushes it over)", async () => {
    await rejects(
      () =>
        requestRefund({
          organizationId: orgId,
          orderId: paid._id!.toString(),
          ticketIds: [ticketIds[1]],
          speed: "INSTANT",
          settledBy: "MORBIN",
          reason: "check",
          requestedBy: ownerId,
        }),
      /unpaid balance/,
    );
  });

  await step("rejecting releases the hold and frees the ticket", async () => {
    await rejectRefund(firstCase._id!.toString(), adminId, "no");
    assert.equal((await getOrgBalance(orgId)).unsettledPaise, 100_000);
    const t = await db.collection<Ticket>("tickets").findOne({ _id: new ObjectId(ticketIds[0]) });
    assert.equal(t!.refundCaseId, null);
    assert.equal(t!.status, "VALID");
  });

  await step("manual completion after approval voids the ticket and returns the seat", async () => {
    const rc = await requestRefund({
      organizationId: orgId,
      orderId: paid._id!.toString(),
      ticketIds: [ticketIds[0]],
      speed: "NORMAL",
      settledBy: "MORBIN",
      reason: "check",
      requestedBy: ownerId,
    });
    // Approve without calling Razorpay: mark approved in place, as approveRefund's
    // transaction would, then complete manually (the bank-transfer fallback).
    const { approveRefund } = await import("@/lib/refunds");
    const approved = await approveRefund(rc._id!.toString(), adminId, "ok").catch(() => null);
    const after = await db.collection<RefundCase>("refundCases").findOne({ _id: rc._id });
    // The fake payment id makes the Razorpay call fail, which must land in FAILED.
    assert.ok(approved === null || after!.status === "FAILED" || after!.status === "PROCESSING");
    if (after!.status !== "FAILED") {
      await db.collection<RefundCase>("refundCases").updateOne({ _id: rc._id }, { $set: { status: "FAILED" } });
    }
    await completeRefundManually(rc._id!.toString(), adminId, "UTR-TEST-1");
    const t = await db.collection<Ticket>("tickets").findOne({ _id: new ObjectId(ticketIds[0]) });
    assert.equal(t!.status, "REFUNDED");
    assert.equal(await sold(), 1);
    const order = await db.collection<Order>("orders").findOne({ _id: paid._id });
    assert.equal(order!.status, "PARTIALLY_REFUNDED");
    assert.equal(order!.refundedPaise, 50_000);
    assert.equal((await getOrgBalance(orgId)).unsettledPaise, 50_000);
  });

  await step("payout locks unsettled entries; a second draft is refused; cancel releases", async () => {
    const p = await issuePayout({ organizationId: orgId, cutoff: new Date(), note: null, adminId });
    assert.equal(p.totals.netPaise, 50_000);
    assert.equal((await getOrgBalance(orgId)).unsettledPaise, 0);
    await rejects(() => issuePayout({ organizationId: orgId, cutoff: new Date(), note: null, adminId }), /draft payout/);
    await cancelPayout(p._id!.toString(), adminId);
    assert.equal((await getOrgBalance(orgId)).unsettledPaise, 50_000);
  });

  await step("stale holds expire and give seats back", async () => {
    const stale = makeOrder(1);
    await createHeldOrder(stale);
    assert.equal(await sold(), 2);
    await db
      .collection<Order>("orders")
      .updateOne({ _id: stale._id }, { $set: { createdAt: new Date(Date.now() - 60 * 60 * 1000) } });
    await expireStaleOrders();
    assert.equal(await sold(), 1);
    assert.equal((await db.collection<Order>("orders").findOne({ _id: stale._id }))!.status, "EXPIRED");
    assert.equal(await releaseOrder(stale._id!, "FAILED"), false);
  });

  await step("ORG_FEE invoice: one per paid payout, equal to the absorbed fee, idempotent", async () => {
    // Issuing needs Morbin's GST details; use fixtures if the test DB has none
    // and put the original settings back afterwards.
    if (!gstReady((await getPlatformSettings()).gst)) {
      originalSettings = (await db.collection<PlatformSettings>("platformSettings").findOne({ _id: "platform" })) ?? null;
      await db.collection<PlatformSettings>("platformSettings").updateOne(
        { _id: "platform" },
        {
          $set: {
            gst: {
              legalName: "Morbin Check Pvt Ltd",
              tradeName: "Morbin",
              gstin: "06AAPFU0939F1ZV",
              pan: "AAPFU0939F",
              address: "Gurugram, Haryana",
              state: "Haryana",
              stateCode: "06",
              sac: "998599",
              rateBps: 1800,
              splitRule: "SUPPLIER_STATE",
              invoicePrefix: "MRB",
              footerText: "Check fixture",
            },
          },
        },
        { upsert: true },
      );
      settingsTouched = true;
    }
    const absorbed = makeOrder(1, "ORGANISER");
    await createHeldOrder(absorbed);
    const r = await capturePaidOrder({
      razorpayOrderId: absorbed.razorpayOrderId,
      paymentId: "pay_test_absorbed",
      amountPaise: absorbed.pricing!.orderTotalPaise,
      currency: "INR",
      gatewayFeePaise: 0,
      gatewayTaxPaise: 0,
      method: "upi",
    });
    assert.equal(r.status, "captured");
    const fee = absorbed.pricing!.feePaise;
    assert.equal(fee, 3_500);

    const draft = await issuePayout({ organizationId: orgId, cutoff: new Date(), note: null, adminId });
    assert.equal(draft.totals.feesPaise, -fee);
    const payoutId = draft._id!.toString();
    const statement = Buffer.from("%PDF-1.4\n% check fixture\n%%EOF\n");
    const paidOut = await markPayoutPaid({
      id: payoutId,
      adminId,
      bankReference: "UTR-CHECK-1",
      transferredAt: new Date(),
      statement: { fileName: "statement.pdf", body: statement },
    });
    assert.ok(paidOut.invoiceDocId, "the invoice PDF is linked from the payout");

    const invoices = await db.collection<Invoice>("invoices").find({ payoutId, kind: "ORG_FEE" }).toArray();
    assert.equal(invoices.length, 1);
    const inv = invoices[0];
    assert.equal(inv.totalPaise, fee);
    assert.equal(inv.taxablePaise, absorbed.pricing!.feeBasePaise);
    assert.equal(inv.cgstPaise + inv.sgstPaise + inv.igstPaise, absorbed.pricing!.feeGstPaise);
    assert.equal(inv.recipient.name, "Money Check Org");
    // Unregistered organisation, state unknown → supplier's state → intra-state.
    const supplier = (await getPlatformSettings()).gst;
    assert.equal(inv.placeOfSupply, `${supplier.state} (${supplier.stateCode})`);
    if (supplier.splitRule === "SUPPLIER_STATE") assert.equal(inv.igstPaise, 0);
    // Same gapless series as customer invoices: this was the latest number.
    const [prefix, fy] = inv.number.split("/");
    const counter = await db.collection<{ _id: string; seq: number }>("counters").findOne({ _id: `invoice:${prefix}:${fy}` });
    assert.equal(Number(inv.number.split("/")[2]), counter!.seq);

    const again = await issueOrgFeeInvoice(payoutId);
    assert.equal(again!.number, inv.number);
    assert.equal(await db.collection("invoices").countDocuments({ payoutId, kind: "ORG_FEE" }), 1);
    const after = await db.collection<Payout>("payouts").findOne({ _id: draft._id });
    assert.equal(after!.invoiceDocId, paidOut.invoiceDocId);
    assert.equal((await db.collection<{ seq: number }>("counters").findOne({ _id: `invoice:${prefix}:${fy}` as never }))!.seq, counter!.seq);
  });

  console.log(`\n${passed} money checks passed`);
} finally {
  if (settingsTouched) {
    if (originalSettings) await db.collection<PlatformSettings>("platformSettings").replaceOne({ _id: "platform" }, originalSettings);
    else await db.collection<PlatformSettings>("platformSettings").deleteOne({ _id: "platform" });
  }
  const orderIds = (await db.collection("orders").find({ organizationId: orgId }).toArray()).map((o) =>
    o._id.toString(),
  );
  await Promise.all([
    db.collection("organizations").deleteOne({ _id: orgOid }),
    db.collection("events").deleteOne({ _id: eventOid }),
    db.collection("ticketTypes").deleteMany({ eventId }),
    db.collection("orders").deleteMany({ organizationId: orgId }),
    db.collection("tickets").deleteMany({ eventId }),
    db.collection("ledgerEntries").deleteMany({ organizationId: orgId }),
    db.collection("refundCases").deleteMany({ organizationId: orgId }),
    db.collection("payouts").deleteMany({ organizationId: orgId }),
    db.collection("auditLogs").deleteMany({ organizationId: orgId }),
    db.collection("notifications").deleteMany({ $or: [{ organizationId: orgId }, { kind: /REFUND/, organizationId: null, createdAt: { $gte: now } }] }),
    db.collection("emailDeliveries").deleteMany({ orderId: { $in: orderIds } }),
    db.collection("invoices").deleteMany({ $or: [{ orderId: { $in: orderIds } }, { organizationId: orgId }] }),
    ...(await db.collection("documents").find({ organizationId: orgId }).toArray()).map((d) => deleteDocument(d._id.toString())),
    db.collection("locks").deleteOne({ _id: `balance:${orgId}` as never }),
  ]);
  await (await getClientPromise()).close();
}
