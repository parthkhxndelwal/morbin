/**
 * The retention job against a real (test) database: an event past its
 * retention is anonymised and its ticket PDF deleted, one inside it is not;
 * invoices (until 8 years) and the ledger are unchanged; abandoned checkouts,
 * old email content and orphan uploads go; referenced uploads stay; a second
 * run changes nothing; two runs at once don't overlap.
 *
 *   npm run check:retention-job
 *
 * Refuses to run unless MORBIN_DB contains "test" or "dev".
 */
import assert from "node:assert/strict";
import { utimes } from "node:fs/promises";
import { ObjectId } from "mongodb";
import { ensureIndexes, getClientPromise, getDb, getDbName } from "@/lib/db";
import { deleteDocument, storeDocument } from "@/lib/documents";
import { listMediaFiles, mediaBucket } from "@/lib/media";
import { getPlatformSettings } from "@/lib/platform-settings";
import { ERASED_EMAIL } from "@/lib/privacy";
import { runRetention } from "@/lib/retention";
import { addMonths } from "@/lib/retention-rules";

if (!/test|dev/i.test(getDbName())) {
  console.error(`Refusing to run against "${getDbName()}"`);
  process.exit(1);
}

await ensureIndexes();
const db = await getDb();
const now = new Date();
const tag = new ObjectId().toString().slice(-8);
const orgOid = new ObjectId();
const orgId = orgOid.toString();
const months = (await getPlatformSettings()).defaultRetentionMonths;
const oldEvent = new ObjectId();
const recentEvent = new ObjectId();
const eventIds = [oldEvent.toString(), recentEvent.toString()];
const docIds: string[] = [];
const mediaKeys = {
  orphan: `events/${oldEvent.toString()}/banner-${crypto.randomUUID()}.png`,
  used: `events/${recentEvent.toString()}/banner-${crypto.randomUUID()}.png`,
  fresh: `events/${recentEvent.toString()}/social-${crypto.randomUUID()}.png`,
};
const oldEmailId = ObjectId.createFromTime(Math.floor((now.getTime() - 100 * 864e5) / 1000));

let passed = 0;
async function step(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

async function seedEvent(_id: ObjectId, endsAt: Date, who: string) {
  const eventId = _id.toString();
  const orderOid = new ObjectId();
  const pdf = await storeDocument({
    organizationId: orgId,
    kind: "TICKET_PDF",
    fileName: "tickets.pdf",
    contentType: "application/pdf",
    body: Buffer.from(`%PDF-1.4 ${who}`),
    uploadedBy: null,
  });
  docIds.push(pdf._id!.toString());
  await db.collection("events").insertOne({
    _id, organizationId: orgId, title: `Retention ${who}`, slug: `retention-${who}-${tag}`, description: "", venue: "X",
    timezone: "Asia/Kolkata", startsAt: endsAt, endsAt, status: "PUBLISHED", createdAt: now, updatedAt: now,
  });
  await db.collection("orders").insertOne({
    _id: orderOid, eventId, organizationId: orgId, buyerName: `Buyer ${who}`, buyerEmail: `${who}.${tag}@example.com`,
    buyerPhone: "+919800000000", items: [{ ticketTypeId: "t", name: "GA", quantity: 1, unitPricePaise: 20_000 }],
    attendees: [{ ticketTypeId: "t", name: `Guest ${who}`, email: `guest.${who}.${tag}@example.com` }],
    subtotalPaise: 20_000, platformFeePaise: 0, organizerAmountPaise: 20_000, totalPaise: 20_000, currency: "INR",
    razorpayOrderId: `ret-${who}-${tag}`, status: "PAID", customFields: [{ fieldId: "f", label: "College", value: "KRMU" }],
    lookupKeys: null, ticketPdfDocId: pdf._id!.toString(), invoiceId: `inv-${who}`, createdAt: endsAt, paidAt: endsAt,
  });
  const orderId = orderOid.toString();
  await db.collection("tickets").insertOne({
    orderId, eventId, ticketTypeId: "t", attendeeName: `Guest ${who}`, attendeeEmail: `guest.${who}.${tag}@example.com`,
    code: `R${who}${tag}`, qrPayload: "x", status: "USED",
  });
  await db.collection("checkoutSessions").insertOne({
    publicId: `ret-${who}-${tag}`, eventId, flowVersion: 1, status: "COMPLETED", answers: { q: "A" }, branch: null,
    identity: { method: "EMAIL_OTP", email: `${who}.${tag}@example.com`, verifiedAt: endsAt, via: "EMAIL_OTP", userId: null },
    otpAttempts: 0, customFields: { f: "KRMU" }, quantity: {}, orderId, utm: { source: null, medium: null, campaign: null },
    createdAt: endsAt, updatedAt: endsAt, expiresAt: endsAt,
  });
  await db.collection("invoices").insertOne({
    number: `RET/${who}/${tag}`, financialYear: "2024-25", kind: "CUSTOMER_FEE", orderId, organizationId: orgId,
    recipient: { name: `Buyer ${who}`, email: `${who}.${tag}@example.com` }, totalPaise: 1_180, issuedAt: endsAt,
  });
  await db.collection("ledgerEntries").insertOne({
    organizationId: orgId, eventId, orderId, refundCaseId: null, type: "SALE", amountPaise: 20_000, memo: "sale",
    key: `sale:${orderId}`, payoutId: null, createdAt: endsAt, createdBy: null,
  });
  return orderId;
}

try {
  await db.collection("organizations").insertOne({ _id: orgOid, name: `Retention ${tag}`, slug: `retention-${tag}`, createdAt: now, updatedAt: now });
  const oldOrder = await seedEvent(oldEvent, addMonths(now, -(months + 1)), "old");
  const recentOrder = await seedEvent(recentEvent, addMonths(now, -(months - 1)), "recent");
  // An invoice issued 9 years ago (past the 8-year period) and one 7 years ago.
  await db.collection("invoices").insertMany([
    { number: `RET/ancient/${tag}`, kind: "CUSTOMER_FEE", orderId: `none-a-${tag}`, organizationId: orgId, recipient: { name: "A", email: "a@example.com" }, totalPaise: 1, issuedAt: addMonths(now, -108) },
    { number: `RET/seven/${tag}`, kind: "CUSTOMER_FEE", orderId: `none-b-${tag}`, organizationId: orgId, recipient: { name: "B", email: "b@example.com" }, totalPaise: 1, issuedAt: addMonths(now, -84) },
  ]);
  await db.collection("checkoutSessions").insertMany([
    { publicId: `ret-abandoned-${tag}`, eventId: eventIds[1], status: "IN_PROGRESS", orderId: null, identity: { email: "x@example.com" }, createdAt: new Date(now.getTime() - 31 * 864e5) },
    { publicId: `ret-young-${tag}`, eventId: eventIds[1], status: "IN_PROGRESS", orderId: null, identity: { email: "y@example.com" }, createdAt: new Date(now.getTime() - 5 * 864e5) },
  ]);
  await db.collection("emailDeliveries").insertMany([
    { _id: oldEmailId, orderId: recentOrder, recipient: `recent.${tag}@example.com`, kind: "TICKET", status: "SENT", attempts: 1, meta: { attendeeName: "Old email" } },
    { orderId: recentOrder, recipient: `recent.${tag}@example.com`, kind: "TICKET", status: "SENT", attempts: 1, meta: { attendeeName: "New email" } },
  ]);
  for (const key of Object.values(mediaKeys)) await mediaBucket().put(key, new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer);
  const twoDaysAgo = new Date(now.getTime() - 48 * 3600_000);
  const fileOf = async (key: string) => (await listMediaFiles()).find((f) => f.key === key)!.file;
  await utimes(await fileOf(mediaKeys.orphan), twoDaysAgo, twoDaysAgo);
  await utimes(await fileOf(mediaKeys.used), twoDaysAgo, twoDaysAgo);
  await db.collection("eventBranding").insertOne({ eventId: eventIds[1], bannerKey: mediaKeys.used, socialImageKey: null });

  const ledgerBefore = await db.collection("ledgerEntries").find({ organizationId: orgId }).sort({ key: 1 }).toArray();
  const invoicesBefore = await db.collection("invoices").find({ orderId: { $in: [oldOrder, recentOrder] } }).sort({ number: 1 }).toArray();

  await step("two runs at once: only one sweeps", async () => {
    const [a, b] = await Promise.all([runRetention({ trigger: "ADMIN" }), runRetention({ trigger: "ADMIN" })]);
    assert.equal([a, b].filter((r) => r.ran).length, 1);
    assert.ok([a, b].some((r) => !r.ran && r.reason === "busy"));
  });

  await step(`an event ended ${months + 1} months ago is anonymised`, async () => {
    const order = await db.collection("orders").findOne({ eventId: eventIds[0] });
    assert.equal(order?.buyerEmail, ERASED_EMAIL);
    assert.equal(order?.buyerPhone, "");
    assert.deepEqual(order?.customFields, []);
    assert.equal(order?.attendees[0].email, ERASED_EMAIL);
    assert.equal(order?.totalPaise, 20_000);
    assert.equal(order?.ticketPdfDocId, null);
    const ticket = await db.collection("tickets").findOne({ eventId: eventIds[0] });
    assert.equal(ticket?.attendeeEmail, ERASED_EMAIL);
    assert.equal(ticket?.code, `Rold${tag}`, "the ticket itself and its code stay");
    const session = await db.collection("checkoutSessions").findOne({ eventId: eventIds[0] });
    assert.equal(session?.identity.email, null);
    assert.ok((await db.collection("events").findOne({ _id: oldEvent }))?.piiPurgedAt);
    assert.equal(await db.collection("documents").countDocuments({ _id: new ObjectId(docIds[0]) }), 0, "ticket PDF deleted");
  });

  await step(`an event ended ${months - 1} months ago is not`, async () => {
    const order = await db.collection("orders").findOne({ eventId: eventIds[1] });
    assert.equal(order?.buyerEmail, `recent.${tag}@example.com`);
    assert.ok(!(await db.collection("events").findOne({ _id: recentEvent }))?.piiPurgedAt);
    assert.equal(await db.collection("documents").countDocuments({ _id: new ObjectId(docIds[1]) }), 1);
  });

  await step("ledger and invoices unchanged; only invoices past 8 years deleted", async () => {
    assert.deepEqual(await db.collection("ledgerEntries").find({ organizationId: orgId }).sort({ key: 1 }).toArray(), ledgerBefore);
    assert.deepEqual(await db.collection("invoices").find({ orderId: { $in: [oldOrder, recentOrder] } }).sort({ number: 1 }).toArray(), invoicesBefore);
    assert.equal(await db.collection("invoices").countDocuments({ number: `RET/ancient/${tag}` }), 0);
    assert.equal(await db.collection("invoices").countDocuments({ number: `RET/seven/${tag}` }), 1);
  });

  await step("abandoned checkouts after 30 days, email content after 90", async () => {
    assert.equal(await db.collection("checkoutSessions").countDocuments({ publicId: `ret-abandoned-${tag}` }), 0);
    assert.equal(await db.collection("checkoutSessions").countDocuments({ publicId: `ret-young-${tag}` }), 1);
    assert.equal(await db.collection("checkoutSessions").countDocuments({ publicId: `ret-recent-${tag}` }), 1, "completed checkouts stay");
    const old = await db.collection("emailDeliveries").findOne({ _id: oldEmailId });
    assert.equal(old?.meta, null);
    assert.equal(old?.status, "SENT", "the delivery row stays");
    assert.equal((await db.collection("emailDeliveries").findOne({ orderId: recentOrder, _id: { $ne: oldEmailId } }))?.meta?.attendeeName, "New email");
  });

  await step("orphan uploads go; referenced and fresh ones stay", async () => {
    const keys = new Set((await listMediaFiles()).map((f) => f.key));
    assert.equal(keys.has(mediaKeys.orphan), false);
    assert.equal(keys.has(mediaKeys.used), true);
    assert.equal(keys.has(mediaKeys.fresh), true, "inside the 24-hour grace period");
  });

  await step("a second run changes nothing, and the schedule waits a day", async () => {
    const again = await runRetention({ trigger: "ADMIN" });
    assert.ok(again.ran);
    if (again.ran) {
      assert.equal(again.counts.events, 0);
      assert.equal(again.counts.orders, 0);
    }
    assert.deepEqual(await runRetention({ trigger: "SCHEDULE" }), { ran: false, reason: "not_due" });
    const run = await db.collection("jobRuns").findOne({ _id: "retention" as never });
    assert.ok(run?.finishedAt && run.counts && run.leaseUntil === null);
  });
} finally {
  const orders = (await db.collection("orders").find({ eventId: { $in: eventIds } }).toArray()).map((o) => o._id.toString());
  await Promise.all([
    db.collection("organizations").deleteOne({ _id: orgOid }),
    db.collection("events").deleteMany({ _id: { $in: [oldEvent, recentEvent] } }),
    db.collection("orders").deleteMany({ eventId: { $in: eventIds } }),
    db.collection("tickets").deleteMany({ eventId: { $in: eventIds } }),
    db.collection("checkoutSessions").deleteMany({ eventId: { $in: eventIds } }),
    db.collection("invoices").deleteMany({ organizationId: orgId }),
    db.collection("ledgerEntries").deleteMany({ organizationId: orgId }),
    db.collection("emailDeliveries").deleteMany({ orderId: { $in: orders } }),
    db.collection("eventBranding").deleteMany({ eventId: { $in: eventIds } }),
    db.collection("jobRuns").deleteOne({ _id: "retention" as never }),
    db.collection("auditLogs").deleteMany({ action: "retention.run" }),
    ...Object.values(mediaKeys).map((k) => mediaBucket().delete(k)),
    ...docIds.map((id) => deleteDocument(id)),
  ]);
  await (await getClientPromise()).close();
}
console.log(`check:retention-job — ${passed} passed`);
