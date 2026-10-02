/**
 * Lookup questions against a real (test) database: matching, the derived
 * email, and the one-ticket-per-row claim under a race. Creates a throwaway
 * organisation and removes everything after.
 *
 *   npm run check:lookups
 *
 * Refuses to run unless MORBIN_DB contains "test" or "dev".
 */
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";
import { ensureIndexes, getClientPromise, getDb, getDbName } from "@/lib/db";
import { lookupProblems, matchLookup, rowClaimed } from "@/lib/lookups";
import { createHeldOrder, releaseOrder } from "@/lib/orders";
import { computePricing } from "@/lib/pricing";
import type { FlowLookup, FlowStep, Order, TicketType } from "@/lib/types";

if (!/test|dev/i.test(getDbName())) {
  console.error(`Refusing to run against "${getDbName()}"`);
  process.exit(1);
}

await ensureIndexes();
const db = await getDb();
const orgId = new ObjectId().toString();
const otherOrgId = new ObjectId().toString();
const eventId = new ObjectId().toString();
const typeOid = new ObjectId();
const datasetOid = new ObjectId();
const datasetId = datasetOid.toString();
const now = new Date();

let passed = 0;
async function step(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const lookup: FlowLookup = {
  datasetId,
  matchColumn: "roll_number",
  emailTemplate: "{{value}}@krmu.edu.in",
  identityMethod: "EMAIL_OTP",
  oneTicketPerRow: true,
};

function order(): Order {
  const pricing = computePricing([{ unitPricePaise: 10_000, quantity: 1 }], { feeBps: 500, gstBps: 1800, bearer: "CUSTOMER" });
  const _id = new ObjectId();
  return {
    _id,
    eventId,
    organizationId: orgId,
    buyerName: "Student",
    buyerEmail: "23013@krmu.edu.in",
    buyerPhone: "",
    items: [{ ticketTypeId: typeOid.toString(), name: "Student Pass", quantity: 1, unitPricePaise: 10_000 }],
    attendees: [],
    subtotalPaise: pricing.ticketTotalPaise,
    platformFeePaise: pricing.feePaise,
    organizerAmountPaise: pricing.organiserNetPaise,
    totalPaise: pricing.orderTotalPaise,
    pricing,
    currency: "INR",
    razorpayOrderId: `pending-${_id}`,
    razorpayPaymentId: null,
    // A paid order stays CREATED (a held seat) until payment: no tickets or emails here.
    status: "CREATED",
    lookupKeys: [{ stepId: "l1", datasetId, key: "23013", claim: true }],
    refundedPaise: 0,
    createdAt: new Date(),
    paidAt: null,
  };
}

try {
  await db.collection("datasets").insertOne({
    _id: datasetOid,
    organizationId: orgId,
    name: "Students",
    columns: [
      { key: "roll_number", label: "Roll number", type: "text" },
      { key: "name", label: "Name", type: "text" },
    ],
    keyColumn: "roll_number",
    rowCount: 2,
    createdBy: "check",
    createdAt: now,
    updatedAt: now,
  });
  await db.collection("datasetRows").insertMany([
    { datasetId, organizationId: orgId, values: { roll_number: "23013", name: "Asha" }, keyNormalised: "23013", createdAt: now, updatedAt: now },
    { datasetId, organizationId: orgId, values: { roll_number: "AB 12", name: "Ravi" }, keyNormalised: "ab12", createdAt: now, updatedAt: now },
  ]);
  await db.collection<TicketType>("ticketTypes").insertOne({
    _id: typeOid,
    eventId,
    name: "Student Pass",
    description: "",
    pricePaise: 10_000,
    capacity: 50,
    soldCount: 0,
  } as TicketType);

  await step("matches case- and space-insensitively and derives the email", async () => {
    const m = await matchLookup(orgId, eventId, lookup, " 23 013 ");
    assert.ok(m.ok);
    assert.equal(m.key, "23013");
    assert.equal(m.derivedEmail, "23013@krmu.edu.in");
    const m2 = await matchLookup(orgId, eventId, { ...lookup, emailTemplate: null }, "ab12");
    assert.ok(m2.ok && m2.key === "ab12" && m2.derivedEmail === null);
  });

  await step("unknown values and other organisations' datasets don't match", async () => {
    assert.deepEqual(await matchLookup(orgId, eventId, lookup, "99999"), { ok: false, reason: "not_found" });
    assert.deepEqual(await matchLookup(otherOrgId, eventId, lookup, "23013"), { ok: false, reason: "not_found" });
  });

  await step("save-time checks name the problem", async () => {
    const s = (l: Partial<FlowLookup>): FlowStep[] => [{ id: "l1", kind: "LOOKUP", title: "Roll", lookup: { ...lookup, ...l } }];
    assert.equal(await lookupProblems(orgId, s({})), null);
    assert.match((await lookupProblems(orgId, s({ emailTemplate: "{{value|lowr}}@x.in" })))!, /Unknown filter “lowr”/);
    assert.match((await lookupProblems(orgId, s({ matchColumn: "nope" })))!, /column the dataset doesn't have/);
    assert.match((await lookupProblems(otherOrgId, s({})))!, /no longer exists/);
  });

  await step("two buyers racing the same row: exactly one order is created", async () => {
    const [a, b] = await Promise.allSettled([createHeldOrder(order()), createHeldOrder(order())]);
    const ok = [a, b].filter((r) => r.status === "fulfilled");
    const failed = [a, b].filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    assert.equal(ok.length, 1, "one wins");
    assert.equal(failed.length, 1, "one loses");
    assert.match(String(failed[0].reason?.message), /already has a ticket/);
    assert.equal((await db.collection<TicketType>("ticketTypes").findOne({ _id: typeOid }))!.soldCount, 1, "the loser holds no seat");
    assert.equal(await db.collection("datasetClaims").countDocuments({ datasetId }), 1);
    assert.equal(await rowClaimed(datasetId, "23013", eventId), true);
    assert.deepEqual(await matchLookup(orgId, eventId, lookup, "23013"), { ok: false, reason: "taken" });
  });

  await step("an expired order gives the row back", async () => {
    const held = await db.collection<Order>("orders").findOne({ eventId, status: "CREATED" });
    assert.ok(await releaseOrder(held!._id!, "EXPIRED"));
    assert.equal(await rowClaimed(datasetId, "23013", eventId), false);
    assert.ok((await matchLookup(orgId, eventId, lookup, "23013")).ok);
  });

  console.log(`\n${passed} lookup checks passed`);
} finally {
  await Promise.all([
    db.collection("datasets").deleteOne({ _id: datasetOid }),
    db.collection("datasetRows").deleteMany({ datasetId }),
    db.collection("datasetClaims").deleteMany({ datasetId }),
    db.collection("ticketTypes").deleteOne({ _id: typeOid }),
    db.collection("orders").deleteMany({ eventId }),
    db.collection("tickets").deleteMany({ eventId }),
  ]);
  await (await getClientPromise()).close();
}
