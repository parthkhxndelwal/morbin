/**
 * DPDP data requests against a real (test) database: request verification, the
 * access export (only this person's data, one download), and erasure (no name,
 * email or phone left outside invoices; ledger and invoices byte-for-byte
 * unchanged). Creates throwaway records and removes everything after.
 *
 *   npm run check:privacy
 *
 * Refuses to run unless MORBIN_DB contains "test" or "dev".
 */
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";
import { hashToken } from "@/lib/checkout";
import { ensureIndexes, getClientPromise, getDb, getDbName } from "@/lib/db";
import {
  anonymisePerson,
  collectPersonalData,
  downloadExport,
  ERASED_EMAIL,
  fulfilAccessRequest,
  fulfilErasureRequest,
  verifyDataRequest,
} from "@/lib/privacy";

if (!/test|dev/i.test(getDbName())) {
  console.error(`Refusing to run against "${getDbName()}"`);
  process.exit(1);
}

await ensureIndexes();
const db = await getDb();
const tag = new ObjectId().toString().slice(-8);
const X = { name: "Priya Privacycheck", email: `priya.${tag}@example.com`, phone: "+919800000001" };
const Y = { name: "Other Attendee", email: `other.${tag}@example.com` };
const orgId = new ObjectId().toString();
const eventOid = new ObjectId();
const eventId = eventOid.toString();
const orderOid = new ObjectId();
const orderId = orderOid.toString();
const adminId = new ObjectId().toString();
const userOid = new ObjectId();
const now = new Date();
const requestIds: ObjectId[] = [];

let passed = 0;
async function step(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

/** Every document that could carry X's data, as one string to search. */
async function footprint(): Promise<string> {
  const docs = await Promise.all([
    db.collection("orders").find({ eventId }).toArray(),
    db.collection("tickets").find({ eventId }).toArray(),
    db.collection("checkoutSessions").find({ eventId }).toArray(),
    db.collection("emailDeliveries").find({ orderId }).toArray(),
    db.collection("refundCases").find({ orderId }).toArray(),
    db.collection("waitlist").find({ email: X.email }).toArray(),
    db.collection("users").find({ _id: userOid }).toArray(),
  ]);
  return JSON.stringify(docs);
}

try {
  await db.collection("events").insertOne({
    _id: eventOid,
    organizationId: orgId,
    title: "Privacy check event",
    slug: `privacy-check-${tag}`,
    description: "",
    venue: "Somewhere",
    timezone: "Asia/Kolkata",
    startsAt: now,
    endsAt: now,
    status: "PUBLISHED",
    createdAt: now,
    updatedAt: now,
  });
  await db.collection("orders").insertOne({
    _id: orderOid,
    eventId,
    organizationId: orgId,
    buyerName: X.name,
    buyerEmail: X.email,
    buyerPhone: X.phone,
    items: [{ ticketTypeId: "t", name: "GA", quantity: 2, unitPricePaise: 50_000 }],
    attendees: [
      { ticketTypeId: "t", name: X.name, email: X.email },
      { ticketTypeId: "t", name: Y.name, email: Y.email },
    ],
    subtotalPaise: 100_000,
    platformFeePaise: 0,
    organizerAmountPaise: 100_000,
    totalPaise: 100_000,
    currency: "INR",
    razorpayOrderId: `privacy-${tag}`,
    status: "PAID",
    customFields: [{ fieldId: "cf_roll", label: "Roll number", value: "ROLL-4242" }],
    lookupKeys: [{ stepId: "s", datasetId: "d", key: "roll-4242", claim: true }],
    consentAt: now,
    noticeVersion: "test",
    createdAt: now,
    paidAt: now,
  });
  // A second, older order without lookup keys (null): erasure must handle both shapes.
  await db.collection("orders").insertOne({
    eventId,
    organizationId: orgId,
    buyerName: X.name,
    buyerEmail: X.email,
    buyerPhone: X.phone,
    items: [],
    subtotalPaise: 0,
    platformFeePaise: 0,
    organizerAmountPaise: 0,
    totalPaise: 0,
    currency: "INR",
    razorpayOrderId: `privacy-old-${tag}`,
    status: "PAID",
    lookupKeys: null,
    createdAt: now,
  });
  await db.collection("tickets").insertMany([
    { orderId, eventId, ticketTypeId: "t", attendeeName: X.name, attendeeEmail: X.email, code: `PX${tag}`, qrPayload: `QRSIG-${tag}`, status: "VALID", lookupKey: "roll-4242" },
    { orderId, eventId, ticketTypeId: "t", attendeeName: Y.name, attendeeEmail: Y.email, code: `PY${tag}`, qrPayload: `QRSIG-${tag}`, status: "VALID" },
  ]);
  await db.collection("checkoutSessions").insertOne({
    publicId: `privacy-${tag}`,
    eventId,
    flowVersion: 1,
    status: "COMPLETED",
    answers: { roll: "ROLL-4242" },
    branch: null,
    identity: { method: "EMAIL_OTP", email: X.email, verifiedAt: now, via: "EMAIL_OTP", userId: userOid.toString() },
    otpAttempts: 0,
    customFields: { cf_roll: "ROLL-4242" },
    quantity: {},
    orderId,
    utm: { source: null, medium: null, campaign: null },
    createdAt: now,
    updatedAt: now,
    expiresAt: now,
  });
  await db.collection("emailDeliveries").insertOne({
    orderId,
    ticketId: null,
    recipient: X.email,
    kind: "TICKET_PDF",
    status: "SENT",
    attempts: 1,
    meta: { attendeeName: X.name, eventTitle: "Privacy check event" },
  });
  await db.collection("refundCases").insertOne({
    organizationId: orgId,
    eventId,
    orderId,
    ticketIds: [],
    amountPaise: 50_000,
    status: "COMPLETED",
    customer: { name: X.name, email: X.email },
    reason: "Can't attend",
    createdAt: now,
    updatedAt: now,
  });
  await db.collection("invoices").insertOne({
    number: `PRIV/${tag}`,
    financialYear: "2026-27",
    kind: "CUSTOMER_FEE",
    orderId,
    organizationId: orgId,
    recipient: { name: X.name, email: X.email },
    totalPaise: 1_180,
    issuedAt: now,
  });
  await db.collection("ledgerEntries").insertMany([
    { organizationId: orgId, eventId, orderId, refundCaseId: null, type: "SALE", amountPaise: 100_000, memo: "sale", key: `sale:${orderId}`, payoutId: null, createdAt: now, createdBy: null },
    { organizationId: orgId, eventId, orderId, refundCaseId: null, type: "REFUND", amountPaise: -50_000, memo: "refund", key: `refund:${orderId}`, payoutId: null, createdAt: now, createdBy: null },
  ]);
  await db.collection("waitlist").insertOne({ email: X.email, createdAt: now });
  await db.collection("users").insertOne({ _id: userOid, name: X.name, email: X.email, createdAt: now });

  await step("a request is confirmed once, by its emailed token", async () => {
    const _id = new ObjectId();
    requestIds.push(_id);
    await db.collection("dataRequests").insertOne({
      _id,
      type: "ACCESS",
      email: X.email,
      details: "",
      status: "UNVERIFIED",
      tokenHash: hashToken(`verify-${tag}`),
      tokenExpiresAt: new Date(Date.now() + 60_000),
      verifiedAt: null,
      dueAt: null,
      outcome: null,
      handledBy: null,
      handledAt: null,
      createdAt: now,
      updatedAt: now,
    });
    assert.equal((await verifyDataRequest("wrong")).ok, false);
    const ok = await verifyDataRequest(`verify-${tag}`);
    assert.equal(ok.ok, true);
    const days = ok.ok ? Math.round((ok.dueAt.getTime() - Date.now()) / 86_400_000) : 0;
    assert.equal(days, 90);
    assert.equal((await verifyDataRequest(`verify-${tag}`)).ok, false, "token is single-use");
    const req = await db.collection("dataRequests").findOne({ _id });
    assert.equal(req?.status, "OPEN");
  });

  await step("an expired confirmation link is refused", async () => {
    const _id = new ObjectId();
    requestIds.push(_id);
    await db.collection("dataRequests").insertOne({
      _id, type: "ERASURE", email: X.email, details: "", status: "UNVERIFIED",
      tokenHash: hashToken(`old-${tag}`), tokenExpiresAt: new Date(Date.now() - 1000),
      verifiedAt: null, dueAt: null, outcome: null, handledBy: null, handledAt: null, createdAt: now, updatedAt: now,
    });
    const r = await verifyDataRequest(`old-${tag}`);
    assert.deepEqual(r, { ok: false, reason: "expired" });
  });

  await step("the export holds this person's data and nobody else's", async () => {
    const data = await collectPersonalData(X.email.toUpperCase());
    const json = JSON.stringify(data);
    assert.equal(data.orders.length, 2);
    assert.equal(data.tickets.length, 1);
    assert.equal(data.checkoutSessions.length, 1);
    assert.equal(data.emailsSent.length, 1);
    assert.equal(data.invoices.length, 1);
    assert.ok(json.includes(X.phone) && json.includes("ROLL-4242"));
    assert.ok(!json.includes(Y.email) && !json.includes(Y.name), "another attendee on the same order is not exported");
    assert.ok(!json.includes("QRSIG-"), "no QR signatures");
  });

  await step("access: one-time download of the stored export", async () => {
    await fulfilAccessRequest(requestIds[0].toString(), adminId, "");
    const req = await db.collection("dataRequests").findOne({ _id: requestIds[0] });
    assert.equal(req?.status, "DONE");
    assert.ok(req?.downloadTokenHash && req.exportDocId);
    // The real token only exists in the email; plant a known one to exercise the download.
    await db.collection("dataRequests").updateOne({ _id: requestIds[0] }, { $set: { downloadTokenHash: hashToken(`dl-${tag}`) } });
    const got = await downloadExport(`dl-${tag}`);
    assert.equal(got.ok, true);
    if (got.ok) assert.equal(JSON.parse(got.body.toString("utf8")).orders.find((o: { id: string }) => o.id === orderId).buyer.email, X.email);
    assert.equal((await downloadExport(`dl-${tag}`)).ok, false, "second download refused");
    assert.equal(await db.collection("documents").countDocuments({ _id: new ObjectId(req!.exportDocId) }), 0, "export deleted after download");
    await assert.rejects(fulfilAccessRequest(requestIds[0].toString(), adminId, ""), /already been handled/);
  });

  await step("erasure leaves no name, email or phone; money untouched", async () => {
    const ledgerBefore = await db.collection("ledgerEntries").find({ organizationId: orgId }).sort({ key: 1 }).toArray();
    const invoiceBefore = await db.collection("invoices").findOne({ orderId });
    const orderBefore = await db.collection("orders").findOne({ _id: orderOid });
    assert.ok((await footprint()).includes(X.email));

    const _id = new ObjectId();
    requestIds.push(_id);
    await db.collection("dataRequests").insertOne({
      _id, type: "ERASURE", email: X.email, details: "", status: "OPEN", tokenHash: null, tokenExpiresAt: null,
      verifiedAt: now, dueAt: new Date(Date.now() + 90 * 86_400_000), outcome: null, handledBy: null, handledAt: null, createdAt: now, updatedAt: now,
    });
    const result = await fulfilErasureRequest(_id.toString(), adminId, "");
    assert.equal(result.invoicesRetained, 1);
    assert.equal(result.account, "deleted");

    const after = await footprint();
    for (const pii of [X.email, X.name, X.phone, "ROLL-4242", "roll-4242", X.email.split("@")[0]]) {
      assert.ok(!after.toLowerCase().includes(pii.toLowerCase()), `"${pii}" still present after erasure`);
    }
    // The other attendee on the same order keeps their ticket and name.
    assert.ok(after.includes(Y.email) && after.includes(Y.name));
    const order = await db.collection("orders").findOne({ _id: orderOid });
    assert.equal(order?.buyerEmail, ERASED_EMAIL);
    assert.ok(order?.piiErasedAt);
    for (const k of ["totalPaise", "subtotalPaise", "organizerAmountPaise", "status", "razorpayOrderId", "items"] as const) {
      assert.deepEqual(order?.[k], orderBefore?.[k], `order.${k} unchanged`);
    }
    assert.deepEqual(await db.collection("ledgerEntries").find({ organizationId: orgId }).sort({ key: 1 }).toArray(), ledgerBefore);
    assert.deepEqual(await db.collection("invoices").findOne({ orderId }), invoiceBefore, "invoice kept as issued (GST law)");
    const closed = await db.collection("dataRequests").findOne({ _id });
    assert.equal(closed?.status, "DONE");
    assert.match(closed?.outcome ?? "", /8 years/);
    const auditRows = await db.collection("auditLogs").find({ targetId: { $in: requestIds.map(String) } }).toArray();
    assert.ok(auditRows.length >= 2);
    assert.ok(!JSON.stringify(auditRows).includes(X.email.split("@")[0]), "audit carries no PII");
  });

  await step("an account that runs an organisation is kept", async () => {
    const uid = new ObjectId();
    const email = `owner.${tag}@example.com`;
    await db.collection("users").insertOne({ _id: uid, name: "Owner", email, createdAt: now });
    await db.collection("memberships").insertOne({ userId: uid.toString(), organizationId: orgId, role: "OWNER", createdAt: now });
    const r = await anonymisePerson(email);
    assert.equal(r.account, "kept_has_role");
    assert.equal(await db.collection("users").countDocuments({ _id: uid }), 1);
    await db.collection("users").deleteOne({ _id: uid });
    await db.collection("memberships").deleteMany({ organizationId: orgId });
  });
} finally {
  await Promise.all([
    db.collection("events").deleteOne({ _id: eventOid }),
    db.collection("orders").deleteMany({ eventId }),
    db.collection("tickets").deleteMany({ eventId }),
    db.collection("checkoutSessions").deleteMany({ eventId }),
    db.collection("emailDeliveries").deleteMany({ $or: [{ orderId }, { recipient: { $in: [X.email, ERASED_EMAIL] } }] }),
    db.collection("refundCases").deleteMany({ orderId }),
    db.collection("invoices").deleteMany({ orderId }),
    db.collection("ledgerEntries").deleteMany({ organizationId: orgId }),
    db.collection("waitlist").deleteMany({ email: X.email }),
    db.collection("users").deleteMany({ _id: userOid }),
    db.collection("memberships").deleteMany({ organizationId: orgId }),
    db.collection("dataRequests").deleteMany({ _id: { $in: requestIds } }),
    db.collection("auditLogs").deleteMany({ targetId: { $in: requestIds.map(String) } }),
    db.collection("notifications").deleteMany({ kind: "DATA_REQUEST_NEW" }),
  ]);
  await (await getClientPromise()).close();
}
console.log(`check:privacy — ${passed} passed`);
